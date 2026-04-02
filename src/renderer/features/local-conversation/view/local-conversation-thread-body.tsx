import type {
  ThreadBodyUiStateOverrides,
  ThreadStageActions,
  ThreadStageModel,
} from "../thread-stage-types";
import { LocalConversationThreadBodyOwner } from "./local-conversation-thread-body-owner";
import { LocalConversationThreadScrollLayout } from "./local-conversation-thread-scroll-controller";

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
    <LocalConversationThreadScrollLayout
      scrollViewClassName="min-h-0 flex-1 px-panel hide-scrollbar electron:md:px-0"
      contentWrapperClassName="h-full min-h-full"
    >
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
  );
}
