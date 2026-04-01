import type { ThreadStageActions, ThreadStageModel } from "../thread-stage-types";
import { LocalConversationComposerShell } from "./composer/local-conversation-composer-shell";
import {
  LocalConversationAboveComposerPortalHost,
  LocalConversationAboveComposerQueuePortalHost,
} from "./local-conversation-above-composer-portal";

interface LocalConversationFooterProps {
  model: ThreadStageModel;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
}

export function LocalConversationFooter({
  model,
  actions,
  errorMessage,
  onErrorMessage,
}: LocalConversationFooterProps) {
  const isResumingActiveThread = !model.isNewThreadTab && model.resumeState !== null && model.resumeState !== "resumed";

  if (isResumingActiveThread) {
    return (
      <div className="mx-auto flex w-full max-w-[var(--thread-composer-max-width)] flex-col px-panel">
        <LocalConversationAboveComposerPortalHost />
        <LocalConversationAboveComposerQueuePortalHost />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[var(--thread-composer-max-width)] flex-col px-panel">
      <LocalConversationAboveComposerPortalHost />
      <LocalConversationAboveComposerQueuePortalHost />
      <LocalConversationComposerShell
        model={model}
        actions={actions}
        errorMessage={errorMessage}
        onErrorMessage={onErrorMessage}
      />
    </div>
  );
}
