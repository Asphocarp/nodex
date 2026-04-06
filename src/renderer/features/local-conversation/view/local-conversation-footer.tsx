import { DownArrowIcon } from "@/components/shared/icons";
import type { ThreadStageActions, ThreadStageModel } from "../thread-stage-types";
import { LocalConversationComposerShell } from "./composer/local-conversation-composer-shell";
import {
  LocalConversationAboveComposerPortalHost,
  LocalConversationAboveComposerQueuePortalHost,
} from "./local-conversation-above-composer-portal";
import { useLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";

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
  const { isScrolledFromBottom, scrollToBottom } =
    useLocalConversationThreadScrollController();
  const isResumingActiveThread = !model.isNewThreadTab && model.resumeState !== null && model.resumeState !== "resumed";
  const showCatchUpControl =
    model.conversation !== null &&
    model.body.turnCount > 0 &&
    isScrolledFromBottom;
  const catchUpControl = showCatchUpControl ? (
    <div className="relative h-0">
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+6*var(--spacing))] flex justify-center">
        <button
          type="button"
          aria-label="Scroll to latest message"
          onClick={scrollToBottom}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-token-border bg-token-background px-1.5 py-1.5 text-size-chat-sm text-token-foreground shadow-card-md hover:bg-token-foreground/5"
        >
          <DownArrowIcon className="size-4" />
        </button>
      </div>
    </div>
  ) : null;

  if (isResumingActiveThread) {
    return (
      <div className="mx-auto flex w-full max-w-[var(--thread-composer-max-width)] flex-col px-panel">
        {catchUpControl}
        <LocalConversationAboveComposerPortalHost />
        <LocalConversationAboveComposerQueuePortalHost />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[var(--thread-composer-max-width)] flex-col px-panel">
      {catchUpControl}
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
