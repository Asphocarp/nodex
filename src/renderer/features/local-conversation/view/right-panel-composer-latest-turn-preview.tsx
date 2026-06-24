import { motion } from "motion/react";
import { ChevronRightIcon } from "@/components/shared/icons";
import { cn } from "@/lib/utils";
import type { CodexTurnDiffReviewTarget } from "../../../lib/types";
import type {
  ThreadStageActions,
  ThreadTurnModel,
} from "../thread-stage-types";
import { ThreadBlockRenderer } from "./blocks/local-conversation-block-renderer";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "./shared/thread-motion";
import { useWorkedForLabelText } from "./shared/use-worked-for-label";

export type RightPanelLatestTurnPreviewState =
  | "preview"
  | "expanded"
  | "collapsed";

interface RightPanelComposerLatestTurnPreviewProps {
  turn: ThreadTurnModel | null;
  state: RightPanelLatestTurnPreviewState;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onStateChange: (state: RightPanelLatestTurnPreviewState) => void;
  onEditLastUserTurn?: (input: { threadId: string; turnId: string; message: string }) => void | Promise<void>;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onOpenThread?: ThreadStageActions["onOpenThread"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
}

const RIGHT_PANEL_LATEST_TURN_MAX_HEIGHT_BY_STATE: Record<
  RightPanelLatestTurnPreviewState,
  string
> = {
  preview: "18rem",
  expanded: "18rem",
  collapsed: "0px",
};

export function RightPanelComposerLatestTurnPreview({
  turn,
  state,
  projectWorkspacePath,
  threadCwd,
  onStateChange,
  onEditLastUserTurn,
  onForkFromTurn,
  onOpenTurnDiffReview,
  onOpenSideChat,
  onOpenThread,
  onOpenMcpAppSidePanel,
}: RightPanelComposerLatestTurnPreviewProps) {
  const workedForLabel = useWorkedForLabelText({
    timing: turn?.workedForTiming ?? null,
    durationMs: turn?.workedDurationMs ?? null,
  });

  if (!turn || turn.blocks.length === 0) return null;

  const isCollapsed = state === "collapsed";
  const headerText = turn.isStreamingTurn ? "Working" : "Latest turn";
  const durationAdornment =
    workedForLabel && workedForLabel !== headerText ? workedForLabel : null;

  return (
    <div
      data-right-panel-latest-turn-preview="true"
      className="bg-token-input-background/70 text-token-foreground border-token-border/80 relative mb-2 overflow-hidden rounded-2xl border backdrop-blur-sm"
    >
      <button
        type="button"
        aria-expanded={!isCollapsed}
        className="flex w-full cursor-interaction items-center justify-between gap-2 px-3 py-row-y text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-token-focus-border focus-visible:ring-inset"
        onClick={() => onStateChange(isCollapsed ? "expanded" : "collapsed")}
      >
        <span className="text-size-chat min-w-0 truncate leading-4 text-token-description-foreground">
          {headerText}
        </span>
        <span className="flex min-w-0 shrink-0 items-center gap-1">
          {durationAdornment ? (
            <span className="text-size-chat max-w-40 truncate leading-4 text-token-description-foreground">
              {durationAdornment}
            </span>
          ) : null}
          <span className="no-drag flex items-center justify-center gap-1 rounded-full border border-token-border border-transparent p-0.5 whitespace-nowrap text-token-description-foreground select-none electron:rounded-md electron:p-1">
            <ChevronRightIcon className={cn("icon-2xs transition-transform duration-150", !isCollapsed && "rotate-90")} />
          </span>
        </span>
      </button>
      <motion.div
        animate={{
          maxHeight: RIGHT_PANEL_LATEST_TURN_MAX_HEIGHT_BY_STATE[state],
          opacity: isCollapsed ? 0 : 1,
        }}
        initial={false}
        transition={CODEX_THREAD_ACCORDION_TRANSITION}
        className={isCollapsed ? "overflow-hidden" : "overflow-visible"}
        style={{ pointerEvents: isCollapsed ? "none" : "auto" }}
      >
        <div className="vertical-scroll-fade-mask scrollbar-token flex max-h-[18rem] flex-col gap-0 overflow-y-auto px-3 pt-0.5 pb-3 [--edge-fade-distance:1rem]">
          {turn.blocks.map((block) => (
            <ThreadBlockRenderer
              key={block.id}
              block={block}
              isLatestTurn={turn.isLatestTurn}
              isStreamingTurn={turn.isStreamingTurn}
              projectWorkspacePath={projectWorkspacePath}
              threadCwd={threadCwd}
              onEditLastUserTurn={onEditLastUserTurn}
              onForkFromTurn={onForkFromTurn}
              onOpenTurnDiffReview={onOpenTurnDiffReview}
              onOpenSideChat={onOpenSideChat}
              onOpenThread={onOpenThread}
              onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
              allowInProgressTurnDiff={true}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}
