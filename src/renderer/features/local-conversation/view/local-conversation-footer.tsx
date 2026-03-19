import type { ThreadStageActions, ThreadStageModel } from "../thread-stage-types";
import { PendingRequestSurface } from "./composer/local-conversation-pending-request-surface";
import { ThreadComposer } from "./composer/local-conversation-thread-composer";
import { LocalConversationAboveComposerPortalHost } from "./local-conversation-above-composer-portal";
import { LocalConversationAboveComposerQueuePortal } from "./local-conversation-above-composer-queue-portal";

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
  const showPendingSurface = Boolean(model.pendingRequestSurface);
  const showComposer = model.pendingRequestSurface?.showComposer ?? true;

  if (isResumingActiveThread) {
    return (
      <div className="relative bg-(--background) pb-0">
        <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-linear-to-t from-(--background) to-transparent" />
        <LocalConversationAboveComposerPortalHost />
        <LocalConversationAboveComposerQueuePortal model={model} actions={actions} />
      </div>
    );
  }

  return (
    <div className="relative bg-(--background) pb-0">
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-4 bg-linear-to-t from-(--background) to-transparent" />
      <LocalConversationAboveComposerPortalHost />
      <LocalConversationAboveComposerQueuePortal model={model} actions={actions} />
      {showPendingSurface ? (
        <div className="mx-auto w-full max-w-[var(--thread-composer-max-width)] px-panel pb-2">
          <PendingRequestSurface model={model} actions={actions} />
        </div>
      ) : null}
      {showComposer ? (
        <ThreadComposer
          model={model}
          actions={actions}
          errorMessage={errorMessage}
          onErrorMessage={onErrorMessage}
        />
      ) : null}
    </div>
  );
}
