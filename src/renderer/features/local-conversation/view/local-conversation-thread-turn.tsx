import { AnimatePresence, motion } from "motion/react";
import { Fragment, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/shared/icons";
import type { CodexTurnDiffReviewTarget } from "../../../lib/types";
import { cn } from "../../../lib/utils";
import type {
  ThreadAgentEntryModel,
  ThreadBlockModel,
  ThreadStageActions,
  ThreadTurnModel,
  ThreadWorkedForAdornmentModel,
} from "../thread-stage-types";
import {
  CODEX_THREAD_ACCORDION_TRANSITION,
  CODEX_THREAD_DIVIDER_ENTER_ANIMATE,
  CODEX_THREAD_DIVIDER_ENTER_INITIAL,
  CODEX_THREAD_DIVIDER_EXIT,
} from "./shared/thread-motion";
import { ThreadWorkedForBlock } from "./blocks/local-conversation-block-leaves";
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
  workedForTimeLabel,
  collapsed,
  onToggle,
}: {
  collapsedMessageCount: number;
  workedForTimeLabel: string | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label = workedForTimeLabel
    ? `Worked for ${workedForTimeLabel}`
    : `${collapsedMessageCount} previous ${collapsedMessageCount === 1 ? "message" : "messages"}`;

  return (
    <div className="text-size-chat flex min-h-0 items-center gap-2 overflow-hidden text-token-text-secondary">
      <div className="flex-1 border-t border-current/20" />
      <button
        type="button"
        className="text-size-chat hover:bg-token-bg-subtle inline-flex items-center gap-2 rounded-md border border-transparent py-1 focus-visible:ring-2 focus-visible:ring-token-focus-border focus-visible:outline-none"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span>
          {workedForTimeLabel ? (
            <span className="text-token-foreground/60">{label}</span>
          ) : (
            <span className="text-token-foreground/60">{label}</span>
          )}
        </span>
        <ChevronDownIcon className={cn("icon-2xs transition-transform duration-200", collapsed ? "-rotate-90" : "rotate-0")} />
      </button>
      <div className="flex-1 border-t border-current/20" />
    </div>
  );
}

function FinalAssistantDividerRow() {
  return (
    <div className="text-size-chat my-2 flex items-center gap-2 text-token-text-secondary">
      <div className="flex-1 border-t border-current/20" />
      <div className="flex items-center gap-1 whitespace-nowrap">Final message</div>
      <div className="flex-1 border-t border-current/20" />
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
}: ThreadTurnProps) {
  const shouldAllowAgentBodyCollapse =
    turn.hasRenderableAgentBodyEntries
    && (!turn.isLatestTurn || hasPersistedAgentBodyCollapsedState);
  const effectiveAgentBodyCollapsed = shouldAllowAgentBodyCollapse ? agentBodyCollapsed : false;
  const showFinalAssistantDivider =
    shouldAllowAgentBodyCollapse
    && !effectiveAgentBodyCollapsed
    && turn.workedForAdornment === null
    && turn.trailingBlocks.some((block) => "entry" in block && block.type === "assistantMessage");
  const workedForTimeLabel = turn.workedForAdornment?.timeLabel ?? null;

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
    />
  );

  const trailingRenderItems = turn.trailingBlocks.flatMap((block) => {
    const items: Array<
      | { id: string; kind: "workedFor"; adornment: ThreadWorkedForAdornmentModel }
      | { id: string; kind: "block"; block: ThreadBlockModel }
    > = [];

    if (turn.workedForAdornment?.anchorBlockId === block.id) {
      items.push({
        id: turn.workedForAdornment.id,
        kind: "workedFor",
        adornment: turn.workedForAdornment,
      });
    }

    items.push({
      id: block.id,
      kind: "block",
      block,
    });

    return items;
  });

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
                  workedForTimeLabel={workedForTimeLabel}
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
              {showFinalAssistantDivider ? <FinalAssistantDividerRow /> : null}
              {showFinalAssistantDivider && turn.trailingBlocks.length > 0 ? <ThreadGap /> : null}
              {renderSpacedBlocks(trailingRenderItems, (item) =>
                item.kind === "workedFor"
                  ? <ThreadWorkedForBlock adornment={item.adornment} />
                  : renderBlock(item.block))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
