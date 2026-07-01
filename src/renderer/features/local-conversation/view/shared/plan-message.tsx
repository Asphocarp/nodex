import { useState, type MouseEvent } from "react";
import { motion } from "motion/react";
import {
  CodexCloseIcon,
  CodexPanelRightVisibleIcon,
  ComposerPlanModeIcon,
} from "@/components/shared/icons";
import { MarkdownRenderer } from "./markdown/markdown-renderer";
import { cn } from "../../../../lib/utils";
import {
  AssistantRatingButton,
  type AssistantMessageRating,
  CopyMessageActionButton,
  ThreadActionIconButton,
} from "./thread-message-actions";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "./thread-motion";

const PLAN_PREVIEW_MAX_HEIGHT_PX = 160;
const PLAN_DOWNLOAD_FILENAME = "PLAN.md";

function DownloadIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="icon-2xs"
      aria-hidden="true"
    >
      <path
        d="M2.66831 12.6664V12.5004C2.66831 12.1331 2.96607 11.8353 3.33334 11.8353C3.70061 11.8353 3.99838 12.1331 3.99838 12.5004V12.6664C3.99838 13.3773 3.99929 13.8708 4.03061 14.2543C4.0613 14.6299 4.11812 14.8414 4.19858 14.9994L4.26889 15.1263C4.4452 15.4138 4.69823 15.6482 5.00034 15.8021L5.13022 15.8578C5.27399 15.9092 5.4635 15.9471 5.74545 15.9701C6.12897 16.0014 6.62231 16.0013 7.33334 16.0013H12.6664C13.3772 16.0013 13.8708 16.0014 14.2542 15.9701C14.6296 15.9394 14.8414 15.8825 14.9994 15.8021L15.1263 15.7308C15.4137 15.5545 15.6482 15.3014 15.8021 14.9994L15.8578 14.8695C15.9092 14.7258 15.947 14.5361 15.9701 14.2543C16.0014 13.8708 16.0013 13.3772 16.0013 12.6664V12.5004C16.0013 12.1332 16.2992 11.8355 16.6664 11.8353C17.0336 11.8353 17.3314 12.1331 17.3314 12.5004V12.6664C17.3314 13.3554 17.332 13.9125 17.2953 14.3627C17.2625 14.7636 17.1975 15.1248 17.0531 15.4613L16.9867 15.6039C16.7212 16.1248 16.3173 16.5606 15.8216 16.8646L15.6039 16.9867C15.2271 17.1787 14.8206 17.2579 14.3626 17.2953C13.9124 17.3321 13.3554 17.3314 12.6664 17.3314H7.33334C6.64425 17.3314 6.0873 17.3321 5.63706 17.2953C5.23651 17.2626 4.87562 17.1982 4.5394 17.0541L4.39682 16.9867C3.8757 16.7212 3.4392 16.3175 3.1351 15.8217L3.01303 15.6039C2.82106 15.2271 2.74186 14.8207 2.70444 14.3627C2.66767 13.9125 2.66831 13.3554 2.66831 12.6664ZM9.3353 3.33337C9.3353 2.9661 9.63307 2.66833 10.0003 2.66833C10.3675 2.66851 10.6654 2.96621 10.6654 3.33337V10.8939L12.8626 8.69666L12.9671 8.61169C13.2253 8.44097 13.5767 8.4693 13.804 8.69666C14.0634 8.95633 14.0635 9.37748 13.804 9.63708L10.4701 12.9701C10.3454 13.0947 10.1766 13.1653 10.0003 13.1654C9.82397 13.1654 9.65434 13.0948 9.52963 12.9701L6.19663 9.63708L6.11166 9.53259C5.9411 9.27445 5.96934 8.92394 6.19663 8.69666C6.42392 8.46937 6.77442 8.44113 7.03256 8.61169L7.13705 8.69666L9.3353 10.8949V3.33337Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface PlanMessageProps {
  content: string;
  completed?: boolean;
  parseIncompleteMarkdown?: boolean;
  isSidePanelActive?: boolean;
  onOpenInSidePanel?: () => void | Promise<void>;
  onCloseSidePanel?: () => void | Promise<void>;
}

export function PlanMessage({
  content,
  completed = true,
  parseIncompleteMarkdown = false,
  isSidePanelActive = false,
  onOpenInSidePanel,
  onCloseSidePanel,
}: PlanMessageProps) {
  const [selectedRating, setSelectedRating] = useState<AssistantMessageRating | null>(null);
  const canOpenSidePanel = completed && Boolean(onOpenInSidePanel);

  const handleDownload = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
      return;
    }

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = PLAN_DOWNLOAD_FILENAME;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  };

  const handleOpenSidePanel = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canOpenSidePanel) return;
    void onOpenInSidePanel?.();
  };

  const handleCloseSidePanel = () => {
    void onCloseSidePanel?.();
  };

  return (
    <div
      className="extension:!bg-token-input-background/50 relative max-h-[200px] cursor-default overflow-clip rounded-lg border border-token-border bg-token-foreground/5 !bg-token-dropdown-background/50 select-none"
      data-plan-side-panel-active={isSidePanelActive ? "true" : "false"}
    >
      {isSidePanelActive ? (
        <button
          type="button"
          aria-label="Close plan side panel"
          className="absolute inset-0 z-10 flex cursor-interaction items-center justify-end px-3 text-token-text-tertiary focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:ring-inset focus-visible:outline-none"
          onClick={handleCloseSidePanel}
        >
          <span className="electron:rounded-md flex size-6 items-center justify-center rounded-full hover:bg-token-list-hover-background">
            <CodexCloseIcon className="icon-2xs shrink-0" />
          </span>
        </button>
      ) : canOpenSidePanel ? (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-0 z-10 cursor-interaction"
          onClick={handleOpenSidePanel}
        />
      ) : null}

      <div className="relative flex h-10 flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-2 text-base leading-tight font-normal text-token-text-tertiary",
            !completed && "loading-shimmer-pure-text",
          )}
        >
          <ComposerPlanModeIcon className="icon-2xs shrink-0" />
          {completed ? "Plan" : "Writing plan"}
        </span>

        <div
          data-plan-action-group="true"
          aria-hidden={isSidePanelActive ? "true" : "false"}
          hidden={isSidePanelActive}
          className="relative z-20 flex items-center gap-1"
        >
          <ThreadActionIconButton label="Download plan" onClick={handleDownload}>
            <DownloadIcon />
          </ThreadActionIconButton>
          <CopyMessageActionButton text={content} label="Copy" copiedLabel="Copied" stopPropagation />
          {completed ? (
            <>
              <AssistantRatingButton
                rating="thumbs_up"
                selectedRating={selectedRating}
                onSelect={setSelectedRating}
              />
              <AssistantRatingButton
                rating="thumbs_down"
                selectedRating={selectedRating}
                onSelect={setSelectedRating}
              />
              {canOpenSidePanel ? (
                <ThreadActionIconButton label="Open plan in side panel" onClick={handleOpenSidePanel}>
                  <CodexPanelRightVisibleIcon className="icon-xs shrink-0" />
                </ThreadActionIconButton>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <motion.div
        data-plan-preview-body="true"
        className="relative overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%_-_4rem),transparent)]"
        initial={false}
        animate={{
          maxHeight: isSidePanelActive ? 0 : PLAN_PREVIEW_MAX_HEIGHT_PX,
          opacity: isSidePanelActive ? 0 : 1,
        }}
        transition={CODEX_THREAD_ACCORDION_TRANSITION}
        aria-hidden={isSidePanelActive ? true : undefined}
        inert={isSidePanelActive ? true : undefined}
      >
        <div className="px-4 py-3">
          <MarkdownRenderer
            content={content}
            parseIncompleteMarkdown={parseIncompleteMarkdown}
            animateStreamingText={!completed && parseIncompleteMarkdown}
            className="codex-markdown-plan text-size-chat"
          />
        </div>
      </motion.div>
    </div>
  );
}
