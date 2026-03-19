import { useState } from "react";
import type { ThreadStageScreenProps } from "../thread-stage-types";
import { LocalConversationFooter } from "./local-conversation-footer";
import { ThreadStageHeader } from "./local-conversation-stage-header";
import { LocalConversationThreadBody } from "./local-conversation-thread-body";

export function LocalConversationStageScreen({ model, actions, initialUiState }: ThreadStageScreenProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--background)">
      <ThreadStageHeader model={model} actions={actions} onErrorMessage={setErrorMessage} />
      <LocalConversationThreadBody
        model={model}
        actions={actions}
        onErrorMessage={setErrorMessage}
        initialUiState={initialUiState}
      />
      <LocalConversationFooter
        model={model}
        actions={actions}
        errorMessage={errorMessage}
        onErrorMessage={setErrorMessage}
      />
    </div>
  );
}
