import { AnimatePresence, motion } from "motion/react";
import { Fragment, type ReactNode } from "react";
import { ChevronRightIcon } from "@/components/shared/icons";
import type { CodexTurnDiffReviewTarget } from "../../../lib/types";
import { cn } from "../../../lib/utils";
import type {
  ThreadAgentEntryModel,
  ThreadBlockModel,
  ThreadStageActions,
  ThreadTurnModel,
} from "../thread-stage-types";
import {
  CODEX_THREAD_ACCORDION_TRANSITION,
  CODEX_THREAD_DIVIDER_ENTER_ANIMATE,
  CODEX_THREAD_DIVIDER_ENTER_INITIAL,
  CODEX_THREAD_DIVIDER_EXIT,
} from "./shared/thread-motion";
import { useWorkedForLabelText } from "./shared/use-worked-for-label";
import { ThreadBlockRenderer } from "./blocks/local-conversation-block-renderer";

interface ThreadTurnProps {
  turn: ThreadTurnModel;
  agentBodyCollapsed: boolean;
  hasPersistedAgentBodyCollapsedState: boolean;
  onAgentBodyCollapsedChange: (turnId: string, collapsed: boolean) => void;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onEditLastUserTurn?: (input: { threadId: string; turnId: string; message: string }) => void | Promise<void>;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onOpenThread?: ThreadStageActions["onOpenThread"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
}

function ThreadGap() {
  return (
    <div
      aria-hidden="true"
      className="w-full"
      style={{ height: "var(--conversation-tool-assistant-gap, 8px)" }}
    />
  );
}

function AgentBodyToggleRow({
  collapsedMessageCount,
  workedForLabel,
  collapsed,
  onToggle,
}: {
  collapsedMessageCount: number;
  workedForLabel: string | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label =
    workedForLabel
    ?? `${collapsedMessageCount} previous ${collapsedMessageCount === 1 ? "message" : "messages"}`;

  return (
    <div className="flex flex-col">
      <div className="text-size-chat text-token-text-secondary">
        <button
          type="button"
          className="text-size-chat hover:bg-token-bg-subtle inline-flex items-center gap-1 rounded-md border border-transparent focus-visible:ring-2 focus-visible:ring-token-focus-border focus-visible:outline-none"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <span>
            <span className="text-token-foreground/60">{label}</span>
          </span>
          <ChevronRightIcon className={cn("icon-2xs text-token-foreground/40 transition-transform duration-200", collapsed ? "rotate-0" : "rotate-90")} />
        </button>
      </div>
      <div className="text-size-chat pt-1 text-token-text-secondary">
        <div className="w-full border-t border-token-border-light" />
      </div>
    </div>
  );
}

function renderSpacedBlocks<TBlock extends { id: string }>(
  blocks: TBlock[],
  renderBlock: (block: TBlock, index: number) => ReactNode,
) {
  return blocks.map((block, index) => (
    <Fragment key={block.id}>
      {index > 0 ? <ThreadGap /> : null}
      {renderBlock(block, index)}
    </Fragment>
  ));
}

export function ThreadTurn({
  turn,
  agentBodyCollapsed,
  hasPersistedAgentBodyCollapsedState,
  onAgentBodyCollapsedChange,
  projectWorkspacePath,
  threadCwd,
  onEditLastUserTurn,
  onForkFromTurn,
  onOpenTurnDiffReview,
  onOpenSideChat,
  onOpenThread,
  onOpenMcpAppSidePanel,
}: ThreadTurnProps) {
  const shouldAllowAgentBodyCollapse =
    turn.hasRenderableAgentBodyEntries
    && (!turn.isLatestTurn || hasPersistedAgentBodyCollapsedState);
  const effectiveAgentBodyCollapsed = shouldAllowAgentBodyCollapse ? agentBodyCollapsed : false;
  const workedForLabel = useWorkedForLabelText({
    timing: turn.workedForItem
      ? {
          status: turn.workedForItem.status,
          startedAtMs: turn.workedForItem.startedAtMs,
          completedAtMs: turn.workedForItem.completedAtMs,
        }
      : null,
    durationMs: turn.workedDurationMs,
  });

  const renderBlock = (block: ThreadBlockModel) => (
    <ThreadBlockRenderer
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
    />
  );

  const renderAgentEntry = (block: ThreadAgentEntryModel) => (
    <ThreadBlockRenderer
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
    />
  );

  return (
    <div>
      <div className="flex flex-col gap-0">
        <div className="flex flex-col">
          {renderSpacedBlocks(turn.leadingBlocks, renderBlock)}
        </div>

        {turn.agentBodyEntries.length > 0 ? (
          <>
            {turn.leadingBlocks.length > 0 ? <ThreadGap /> : null}
            <div className="flex flex-col">
              {shouldAllowAgentBodyCollapse ? (
                <AgentBodyToggleRow
                  collapsedMessageCount={turn.collapsedMessageCount}
                  workedForLabel={workedForLabel}
                  collapsed={effectiveAgentBodyCollapsed}
                  onToggle={() => onAgentBodyCollapsedChange(turn.turnId, !effectiveAgentBodyCollapsed)}
                />
              ) : null}
              <AnimatePresence initial={false}>
                {effectiveAgentBodyCollapsed ? null : (
                  <motion.div
                    key="agent-body"
                    initial={CODEX_THREAD_DIVIDER_ENTER_INITIAL}
                    animate={CODEX_THREAD_DIVIDER_ENTER_ANIMATE}
                    exit={CODEX_THREAD_DIVIDER_EXIT}
                    transition={CODEX_THREAD_ACCORDION_TRANSITION}
                    style={{ overflow: "hidden" }}
                  >
                    {shouldAllowAgentBodyCollapse ? <ThreadGap /> : null}
                    <div className="flex flex-col gap-0">
                      {renderSpacedBlocks(turn.agentBodyEntries, renderAgentEntry)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : null}

        {turn.trailingBlocks.length > 0 ? (
          <>
            {(turn.leadingBlocks.length > 0 || turn.agentBodyEntries.length > 0) ? <ThreadGap /> : null}
            <div className="flex flex-col">
              {renderSpacedBlocks(turn.trailingBlocks, renderBlock)}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
