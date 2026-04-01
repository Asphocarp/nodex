import { useState } from "react";
import type { ThreadStageScreenProps } from "../thread-stage-types";
import { LocalConversationFooter, ThreadStageHeader } from "./local-conversation-stage-screen-deps";
import { LocalConversationThreadBody } from "./local-conversation-thread-body";

export function LocalConversationStageScreen({ model, actions, initialUiState }: ThreadStageScreenProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-(--background) [--thread-footer-overlap:0px] electron:[--thread-footer-overlap:var(--radius-4xl)]">
      <div className="sticky top-0 z-10">
        <ThreadStageHeader model={model} actions={actions} onErrorMessage={setErrorMessage} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative mx-auto flex min-h-0 w-full flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <LocalConversationThreadBody
              model={model}
              actions={actions}
              onErrorMessage={setErrorMessage}
              initialUiState={initialUiState}
            />
          </div>
        </div>
        <div className="z-10 w-full pb-2">
          <LocalConversationFooter
            model={model}
            actions={actions}
            errorMessage={errorMessage}
            onErrorMessage={setErrorMessage}
          />
        </div>
      </div>
    </div>
  );
}
