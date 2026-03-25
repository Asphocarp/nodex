import type { ThreadStageActions, ThreadStageModel } from "../thread-stage-types";
import { LocalConversationComposerShell } from "./composer/local-conversation-composer-shell";
import { LocalConversationAboveComposerPortalHost } from "./local-conversation-above-composer-portal";

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
      <div className="relative bg-(--background) pb-0">
        <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-linear-to-t from-(--background) to-transparent" />
        <LocalConversationAboveComposerPortalHost />
      </div>
    );
  }

  return (
    <div className="relative bg-(--background) pb-0">
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-linear-to-t from-(--background) to-transparent" />
      <LocalConversationAboveComposerPortalHost />
      <LocalConversationComposerShell
        model={model}
        actions={actions}
        errorMessage={errorMessage}
        onErrorMessage={onErrorMessage}
      />
    </div>
  );
}
