import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DownArrowIcon } from "@/components/shared/icons";
import { AnimatePresence, motion } from "motion/react";
import { selectTurnRenderModel } from "../projection/build-turn-render-model";
import { selectVisibleConversationTurnEntries } from "../selectors";
import type {
  ThreadFooterModel,
  ThreadPlanSidePanelState,
  ThreadStageActions,
} from "../thread-stage-types";
import { shouldShowThreadScrollToBottomControl } from "./local-conversation-turn-virtualization";
import { LocalConversationComposerShell } from "./composer/local-conversation-composer-shell";
import {
  LocalConversationAboveComposerPortalHost,
  LocalConversationAboveComposerQueuePortalHost,
} from "./local-conversation-above-composer-portal";
import { useLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";
import {
  RightPanelComposerLatestTurnPreview,
  type RightPanelLatestTurnPreviewState,
} from "./right-panel-composer-latest-turn-preview";
import { RightPanelComposerOverlay } from "./right-panel-composer-overlay";

interface LocalConversationFooterProps {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
  variant?: "thread" | "newThreadHome";
  rightPanelComposerOverlay?: {
    enabled: boolean;
    target: HTMLElement | null;
  };
  planSidePanelState?: ThreadPlanSidePanelState | null;
  turnDiffHoverPreviewDisabled?: boolean;
}

function LocalConversationFooterChrome({
  model,
  actions,
  errorMessage,
  onErrorMessage,
  catchUpControl,
  latestTurnPreview,
  showComposer = true,
}: {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
  catchUpControl: ReactNode;
  latestTurnPreview?: ReactNode;
  showComposer?: boolean;
}) {
  const [hasFixedPortalContent, setHasFixedPortalContent] = useState(false);

  return (
    <div className="flex flex-col" data-thread-find-composer="true">
      {catchUpControl}
      <div className="flex flex-col" data-thread-footer-stack="true">
        <LocalConversationAboveComposerPortalHost
          conversationId={model.threadId}
          onContentPresenceChange={setHasFixedPortalContent}
        />
        <LocalConversationAboveComposerQueuePortalHost conversationId={model.threadId} />
        {latestTurnPreview}
        {showComposer ? (
          <LocalConversationComposerShell
            model={model}
            actions={actions}
            errorMessage={errorMessage}
            onErrorMessage={onErrorMessage}
            hasFixedPortalContent={hasFixedPortalContent}
          />
        ) : null}
      </div>
    </div>
  );
}

function LocalConversationFooterComponent({
  model,
  actions,
  errorMessage,
  onErrorMessage,
  variant = "thread",
  rightPanelComposerOverlay,
  planSidePanelState,
  turnDiffHoverPreviewDisabled = false,
}: LocalConversationFooterProps) {
  const {
    addScrollListener,
    clearPendingLatestTurnSubmitPlacement,
    getLastScrollDistanceFromBottomPx,
    isScrolledFromBottom,
    prepareLatestTurnSubmitPlacement,
    responseSpacerState,
    scrollToBottom,
  } = useLocalConversationThreadScrollController();
  const [scrollDistanceFromBottomPx, setScrollDistanceFromBottomPx] = useState(
    () => getLastScrollDistanceFromBottomPx(),
  );
  const [latestTurnPreviewState, setLatestTurnPreviewState] =
    useState<RightPanelLatestTurnPreviewState>("preview");
  const isResumingActiveThread = !model.isNewThreadTab && model.resumeState !== null && model.resumeState !== "resumed";
  const rightPanelOverlayEnabled =
    variant === "thread" &&
    rightPanelComposerOverlay?.enabled === true &&
    !isResumingActiveThread &&
    !model.isNewThreadTab &&
    model.threadId !== null &&
    model.conversation !== null;
  const latestTurn = useMemo(() => {
    if (!rightPanelOverlayEnabled || !model.conversation) return null;

    const visibleTurns = selectVisibleConversationTurnEntries({
      conversation: model.conversation,
    });
    const latestVisibleTurn = visibleTurns[visibleTurns.length - 1] ?? null;
    if (!latestVisibleTurn) return null;

    return selectTurnRenderModel({
      entry: latestVisibleTurn,
      surface: "preview",
      canEditTurnUserPrefix: false,
      canForkTurn: false,
    });
  }, [model.conversation, rightPanelOverlayEnabled]);
  useEffect(() => {
    if (!rightPanelOverlayEnabled || !latestTurn) return;

    setLatestTurnPreviewState("preview");
  }, [latestTurn?.turnKey, rightPanelOverlayEnabled]);
  useEffect(
    () => addScrollListener(setScrollDistanceFromBottomPx),
    [addScrollListener],
  );

  const actionsWithSubmitPlacement = useMemo<ThreadStageActions>(() => {
    const prepareExistingThreadPlacement = () => {
      if (model.threadId === null || model.conversation === null) return false;
      prepareLatestTurnSubmitPlacement();
      return true;
    };

    return {
      ...actions,
      onSendPrompt: async (...args) => {
        const prepared = prepareExistingThreadPlacement();
        try {
          await actions.onSendPrompt(...args);
        } catch (error) {
          if (prepared) {
            clearPendingLatestTurnSubmitPlacement();
          }
          throw error;
        }
      },
      onSteerPrompt: async (...args) => {
        const prepared = prepareExistingThreadPlacement();
        try {
          await actions.onSteerPrompt(...args);
        } catch (error) {
          if (prepared) {
            clearPendingLatestTurnSubmitPlacement();
          }
          throw error;
        }
      },
      onEnqueueQueuedFollowUp: async (...args) => {
        const prepared = prepareExistingThreadPlacement();
        try {
          await actions.onEnqueueQueuedFollowUp(...args);
          if (prepared) {
            clearPendingLatestTurnSubmitPlacement();
          }
        } catch (error) {
          if (prepared) {
            clearPendingLatestTurnSubmitPlacement();
          }
          throw error;
        }
      },
      onSendQueuedFollowUpNow: async (...args) => {
        const prepared = prepareExistingThreadPlacement();
        try {
          await actions.onSendQueuedFollowUpNow(...args);
        } catch (error) {
          if (prepared) {
            clearPendingLatestTurnSubmitPlacement();
          }
          throw error;
        }
      },
    };
  }, [
    actions,
    clearPendingLatestTurnSubmitPlacement,
    model.conversation,
    model.threadId,
    prepareLatestTurnSubmitPlacement,
  ]);

  const responseSpacerHeightPx = responseSpacerState?.getHeightPx() ?? null;
  const showCatchUpControl =
    model.threadId !== null &&
    model.body.turnCount > 0 &&
    shouldShowThreadScrollToBottomControl({
      isScrollToTopEnabled: responseSpacerState !== null,
      isScrolledFromBottom,
      responseSpacerHeightPx,
      scrollDistanceFromBottomPx,
    });
  const handleCatchUpClick = useCallback(() => {
    if (responseSpacerState) {
      responseSpacerState.scrollToBottom();
      return;
    }
    scrollToBottom();
  }, [responseSpacerState, scrollToBottom]);
  const catchUpControl = (
    <div className="relative h-0" data-thread-catch-up-control="true">
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
              onClick={handleCatchUpClick}
              className="pointer-events-auto inline-flex size-8 items-center justify-center rounded-full border border-token-border bg-token-background text-token-foreground shadow-card-md hover:bg-token-foreground/5"
            >
              <DownArrowIcon className="size-4" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
  const latestTurnPreview = rightPanelOverlayEnabled ? (
    <RightPanelComposerLatestTurnPreview
      turn={latestTurn}
      state={latestTurnPreviewState}
      projectWorkspacePath={model.projectWorkspacePath}
      threadCwd={model.cwd}
      onStateChange={setLatestTurnPreviewState}
      onEditLastUserTurn={actions.onEditLastUserTurn}
      onForkFromTurn={actions.onForkFromTurn}
      onOpenTurnDiffReview={actions.onOpenTurnDiffReview}
      onOpenTurnDiffFileInSidePanel={actions.onOpenTurnDiffFileInSidePanel}
      onOpenSideChat={actions.onOpenSideChat}
      onOpenThread={actions.onOpenThread}
      onOpenMcpAppSidePanel={actions.onOpenMcpAppSidePanel}
      onOpenPlanInSidePanel={actions.onOpenPlanInSidePanel}
      onClosePlanSidePanel={actions.onClosePlanSidePanel}
      planSidePanelState={planSidePanelState}
      turnDiffHoverPreviewDisabled={rightPanelOverlayEnabled || turnDiffHoverPreviewDisabled}
    />
  ) : null;

  if (rightPanelOverlayEnabled) {
    return (
      <RightPanelComposerOverlay
        target={rightPanelComposerOverlay?.target ?? null}
        visible={rightPanelOverlayEnabled}
        onPointerDownOutside={() => {
          setLatestTurnPreviewState("collapsed");
        }}
      >
        <LocalConversationFooterChrome
          model={model}
          actions={actionsWithSubmitPlacement}
          errorMessage={errorMessage}
          onErrorMessage={onErrorMessage}
          catchUpControl={catchUpControl}
          latestTurnPreview={latestTurnPreview}
        />
      </RightPanelComposerOverlay>
    );
  }

  if (isResumingActiveThread) {
    return (
      <div className={variant === "newThreadHome" ? "min-w-0 w-full" : "mx-auto flex w-full max-w-(--thread-content-max-width) flex-col px-toolbar"}>
        <LocalConversationFooterChrome
          model={model}
          actions={actionsWithSubmitPlacement}
          errorMessage={errorMessage}
          onErrorMessage={onErrorMessage}
          catchUpControl={catchUpControl}
          showComposer={false}
        />
      </div>
    );
  }

  return (
    <div className={variant === "newThreadHome" ? "min-w-0 w-full" : "mx-auto flex w-full max-w-(--thread-content-max-width) flex-col px-toolbar"}>
      <LocalConversationFooterChrome
        model={model}
        actions={actionsWithSubmitPlacement}
        errorMessage={errorMessage}
        onErrorMessage={onErrorMessage}
        catchUpControl={catchUpControl}
      />
    </div>
  );
}

export const LocalConversationFooter = memo(LocalConversationFooterComponent);
