import { AnimatePresence, motion } from "motion/react";
import { Fragment, type ReactNode } from "react";
import { ChevronRightIcon } from "@/components/shared/icons";
import type { CodexConversationChildMembership } from "../../../lib/types";
import type { ReviewOpenIntent } from "@/features/review/model/review-view-state";
import { cn } from "../../../lib/utils";
import { useMcpServerStatuses } from "../../../lib/use-mcp-queries";
import { useCodexMcpApps } from "../use-codex-mcp-apps";
import { buildV2AgentRenderUnits } from "../projection/build-turn-view-model";
import type {
  ThreadAgentRenderUnit,
  ThreadBlockModel,
  ThreadPlanSidePanelState,
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
import { ThreadMcpAppsProvider } from "./shared/tools/mcp-apps-context";

interface ThreadTurnProps {
  turn: ThreadTurnModel;
  agentBodyCollapsed: boolean;
  onAgentBodyCollapsedChange: (turnId: string, collapsed: boolean) => void;
  projectWorkspacePath?: string | null;
  childMemberships?: readonly CodexConversationChildMembership[];
  threadCwd?: string | null;
  onEditLastUserTurn?: (input: { threadId: string; turnId: string; message: string }) => void | Promise<void>;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
  onOpenTurnDiffReview?: (intent: ReviewOpenIntent) => void | Promise<void>;
  onOpenTurnDiffFileInSidePanel?: ThreadStageActions["onOpenTurnDiffFileInSidePanel"];
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onOpenThread?: ThreadStageActions["onOpenThread"];
  onOpenSummaryScheduledAutomation?: ThreadStageActions["onOpenSummaryScheduledAutomation"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
  onOpenPlanInSidePanel?: ThreadStageActions["onOpenPlanInSidePanel"];
  onClosePlanSidePanel?: ThreadStageActions["onClosePlanSidePanel"];
  planSidePanelState?: ThreadPlanSidePanelState | null;
  turnDiffHoverPreviewDisabled?: boolean;
  latestTurnFollowContentRef?: (element: HTMLDivElement | null) => void;
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
    <Fragment key={resolveThreadBlockRenderKey(block)}>
      {index > 0 ? <ThreadGap /> : null}
      {renderBlock(block, index)}
    </Fragment>
  ));
}

function renderAgentUnits(
  units: ThreadAgentRenderUnit[],
  renderUnit: (unit: ThreadAgentRenderUnit, index: number) => ReactNode,
) {
  return units.map((unit, index) => {
    const hasTargets = unit.targetAttributes !== undefined;
    return (
      <div
        key={resolveThreadBlockRenderKey(unit.block)}
        className={hasTargets ? "outline-none" : undefined}
        tabIndex={hasTargets ? -1 : undefined}
        {...unit.targetAttributes}
      >
        {renderUnit(unit, index)}
      </div>
    );
  });
}

export function resolveThreadBlockRenderKey(block: { id: string; renderKey?: unknown }): string {
  const renderKey = (block as { renderKey?: unknown }).renderKey;
  return typeof renderKey === "string" && renderKey.length > 0 ? renderKey : block.id;
}

function ThreadTurnBody({
  agentBodyUnits,
  turn,
  agentBodyCollapsed,
  onAgentBodyCollapsedChange,
  projectWorkspacePath,
  threadCwd,
  onEditLastUserTurn,
  onForkFromTurn,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  onOpenSideChat,
  onOpenThread,
  onOpenSummaryScheduledAutomation,
  onOpenMcpAppSidePanel,
  onOpenPlanInSidePanel,
  onClosePlanSidePanel,
  planSidePanelState,
  childMemberships,
  turnDiffHoverPreviewDisabled = false,
  latestTurnFollowContentRef,
}: ThreadTurnProps & { agentBodyUnits: ThreadAgentRenderUnit[] }) {
  const shouldAllowAgentBodyCollapse = turn.hasRenderableAgentBodyUnits;
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
      childMemberships={childMemberships}
      threadCwd={threadCwd}
      onEditLastUserTurn={onEditLastUserTurn}
      onForkFromTurn={onForkFromTurn}
      onOpenTurnDiffReview={onOpenTurnDiffReview}
      onOpenTurnDiffFileInSidePanel={onOpenTurnDiffFileInSidePanel}
      onOpenSideChat={onOpenSideChat}
      onOpenThread={onOpenThread}
      onOpenSummaryScheduledAutomation={onOpenSummaryScheduledAutomation}
      onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
      onOpenPlanInSidePanel={onOpenPlanInSidePanel}
      onClosePlanSidePanel={onClosePlanSidePanel}
      planSidePanelState={planSidePanelState}
      turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
    />
  );

  const renderAgentUnit = (unit: ThreadAgentRenderUnit) => (
    <ThreadBlockRenderer
      block={unit.block}
      isLatestTurn={turn.isLatestTurn}
      isStreamingTurn={turn.isStreamingTurn}
      projectWorkspacePath={projectWorkspacePath}
      childMemberships={childMemberships}
      threadCwd={threadCwd}
      onEditLastUserTurn={onEditLastUserTurn}
      onForkFromTurn={onForkFromTurn}
      onOpenTurnDiffReview={onOpenTurnDiffReview}
      onOpenTurnDiffFileInSidePanel={onOpenTurnDiffFileInSidePanel}
      onOpenSideChat={onOpenSideChat}
      onOpenThread={onOpenThread}
      onOpenSummaryScheduledAutomation={onOpenSummaryScheduledAutomation}
      onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
      onOpenPlanInSidePanel={onOpenPlanInSidePanel}
      onClosePlanSidePanel={onClosePlanSidePanel}
      planSidePanelState={planSidePanelState}
      turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
    />
  );

  return (
    <div>
      <div className="flex flex-col gap-0">
        <div className="flex flex-col">
          {renderSpacedBlocks(turn.leadingBlocks, renderBlock)}
        </div>

        {agentBodyUnits.length > 0 ? (
          <>
            {turn.leadingBlocks.length > 0 ? <ThreadGap /> : null}
            <div className="flex flex-col">
              {shouldAllowAgentBodyCollapse ? (
                <AgentBodyToggleRow
                  collapsedMessageCount={agentBodyUnits.length}
                  workedForLabel={workedForLabel}
                  collapsed={effectiveAgentBodyCollapsed}
                  onToggle={() => onAgentBodyCollapsedChange(turn.turnKey, !effectiveAgentBodyCollapsed)}
                />
              ) : null}
              <AnimatePresence initial={false}>
                {effectiveAgentBodyCollapsed ? null : (
                  <motion.div
                    ref={latestTurnFollowContentRef}
                    key="agent-body"
                    initial={CODEX_THREAD_DIVIDER_ENTER_INITIAL}
                    animate={CODEX_THREAD_DIVIDER_ENTER_ANIMATE}
                    exit={CODEX_THREAD_DIVIDER_EXIT}
                    transition={CODEX_THREAD_ACCORDION_TRANSITION}
                    style={{ overflow: "hidden" }}
                  >
                    {shouldAllowAgentBodyCollapse ? <ThreadGap /> : null}
                    <div className="flex flex-col gap-[var(--conversation-item-gap,16px)]">
                      {renderAgentUnits(agentBodyUnits, renderAgentUnit)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : null}

        {turn.trailingBlocks.length > 0 ? (
          <>
            {(turn.leadingBlocks.length > 0 || agentBodyUnits.length > 0) ? <ThreadGap /> : null}
            <div className="flex flex-col">
              {renderSpacedBlocks(turn.trailingBlocks, renderBlock)}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ThreadTurnWithMcpStatuses(props: ThreadTurnProps) {
  const { data: mcpApps } = useCodexMcpApps();
  const { data: mcpServerStatuses } = useMcpServerStatuses();
  const thinkingPlaceholder = props.turn.blocks.find(
    (block) => block.type === "thinkingPlaceholder",
  );
  const thinkingGroup = props.turn.blocks.find(
    (block) => block.type === "agentActivityGroup" && block.liveHeaderKind === "thinking",
  );
  const allowThinkingFallback = thinkingPlaceholder !== undefined || thinkingGroup !== undefined;
  const thinkingFallbackLabel = thinkingPlaceholder?.type === "thinkingPlaceholder"
    ? thinkingPlaceholder.message
    : thinkingGroup?.type === "agentActivityGroup"
      ? thinkingGroup.runningSummary?.label
      : undefined;
  const agentBodyUnits = buildV2AgentRenderUnits(
    props.turn.agentActivitySourceItems,
    {
      mcpApps: mcpApps ?? [],
      mcpServerStatuses: mcpServerStatuses ?? null,
      isTurnCancelled: props.turn.turn?.status === "interrupted",
      liveActivity: {
        allowThinkingFallback,
        isTurnInProgress: props.turn.isStreamingTurn,
        isActivitySliceClosed: props.turn.isAgentActivitySliceClosed ?? false,
        isExploring: props.turn.isAgentActivityExploring ?? false,
        thinkingFallbackLabel,
      },
    },
  ).units;

  return (
    <ThreadMcpAppsProvider apps={mcpApps ?? []}>
      <ThreadTurnBody {...props} agentBodyUnits={agentBodyUnits} />
    </ThreadMcpAppsProvider>
  );
}

export function ThreadTurn(props: ThreadTurnProps) {
  const hasMcpActivity = props.turn.agentActivitySourceItems.some(
    (item) => item.type === "mcpToolCall",
  );
  if (hasMcpActivity) {
    return <ThreadTurnWithMcpStatuses {...props} />;
  }

  return <ThreadTurnBody {...props} agentBodyUnits={props.turn.agentBodyUnits} />;
}
