import { memo } from "react";
import { DownArrowIcon } from "@/components/shared/icons";
import { AnimatePresence, motion } from "motion/react";
import type { ThreadFooterModel, ThreadStageActions } from "../thread-stage-types";
import { LocalConversationComposerShell } from "./composer/local-conversation-composer-shell";
import {
  LocalConversationAboveComposerPortalHost,
  LocalConversationAboveComposerQueuePortalHost,
} from "./local-conversation-above-composer-portal";
import { useLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";

interface LocalConversationFooterProps {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
}

function LocalConversationFooterComponent({
  model,
  actions,
  errorMessage,
  onErrorMessage,
}: LocalConversationFooterProps) {
  const { isScrolledFromBottom, scrollToBottom } =
    useLocalConversationThreadScrollController();
  const isResumingActiveThread = !model.isNewThreadTab && model.resumeState !== null && model.resumeState !== "resumed";
  const showCatchUpControl =
    model.threadId !== null &&
    model.body.turnCount > 0 &&
    isScrolledFromBottom;
  const catchUpControl = (
    <div className="relative h-0">
      <AnimatePresence initial={false}>
        {showCatchUpControl ? (
          <motion.div
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeInOut" }}
            className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+6*var(--spacing))] flex justify-center"
          >
            <button
              type="button"
              aria-label="Scroll to latest message"
              onClick={scrollToBottom}
              className="pointer-events-auto inline-flex size-8 items-center justify-center rounded-full border border-token-border bg-token-background text-token-foreground shadow-card-md hover:bg-token-foreground/5"
            >
              <DownArrowIcon className="size-4" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );

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

export const LocalConversationFooter = memo(
  LocalConversationFooterComponent,
  (left, right) =>
    left.actions === right.actions
    && left.errorMessage === right.errorMessage
    && left.onErrorMessage === right.onErrorMessage
    && left.model.resumeState === right.model.resumeState
    && left.model.isNewThreadTab === right.model.isNewThreadTab
    && left.model.isQueueingEnabled === right.model.isQueueingEnabled
    && left.model.threadId === right.model.threadId
    && left.model.body.turnCount === right.model.body.turnCount
    && left.model.body.hasAboveComposerBlocks === right.model.body.hasAboveComposerBlocks
    && left.model.composerShell === right.model.composerShell,
);
