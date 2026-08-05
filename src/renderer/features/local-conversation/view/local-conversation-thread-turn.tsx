import { AnimatePresence, motion } from "motion/react";
import { Fragment, type ReactNode } from "react";
import { ChevronRightIcon } from "@/components/shared/icons";
import type {
  CodexConversationChildMembership,
  ProtocolAppInfo,
  ProtocolListMcpServerStatusResponse,
} from "../../../lib/types";
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
import { CodexShimmerText } from "./shared/codex-shimmer-text";
import { ThreadBlockRenderer } from "./blocks/local-conversation-block-renderer";
import { ThreadMcpAppsProvider } from "./shared/tools/mcp-apps-context";

const EMPTY_THREAD_LIVE_ACTIVITY: ThreadTurnModel["liveActivity"] = {
  state: "none",
  placement: "none",
  reasoningSummary: null,
  isActivitySliceClosed: true,
};

function normalizeThreadLiveActivity(turn: ThreadTurnModel): ThreadTurnModel {
  if (turn.liveActivity) return turn;
  return {
    ...turn,
    liveActivity: EMPTY_THREAD_LIVE_ACTIVITY,
  };
}

interface ThreadTurnProps {
  turn: ThreadTurnModel;
  agentBodyCollapsed: boolean;
  onAgentBodyCollapsedChange: (turnId: string, collapsed: boolean) => void;
  projectWorkspacePath?: string | null;
  projectlessOutputDirectory?: string | null;
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

function ThreadLiveActivityFallbackForTurn({ turn }: { turn: ThreadTurnModel }) {
  if (
    turn.liveActivity.placement !== "standalone"
    || turn.liveActivity.state === "none"
  ) {
    return null;
  }

  return <ThreadLiveActivityFallback message={turn.liveActivity.reasoningSummary?.text} />;
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
  projectlessOutputDirectory,
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
      projectlessOutputDirectory={projectlessOutputDirectory}
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
      projectlessOutputDirectory={projectlessOutputDirectory}
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

        {turn.liveActivity.placement === "standalone" ? (
          <>
            {(turn.leadingBlocks.length > 0
              || agentBodyUnits.length > 0
              || turn.trailingBlocks.length > 0) ? <ThreadGap /> : null}
            <ThreadLiveActivityFallbackForTurn turn={turn} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function buildLiveAgentBodyUnits(
  turn: ThreadTurnModel,
  mcpApps: readonly ProtocolAppInfo[],
  mcpServerStatuses: ProtocolListMcpServerStatusResponse | null,
): ThreadAgentRenderUnit[] {
  return buildV2AgentRenderUnits(
    turn.agentActivitySourceItems,
    {
      mcpApps,
      mcpServerStatuses,
      isTurnCancelled: turn.turn?.status === "interrupted",
      liveActivity: {
        isTurnInProgress: turn.isStreamingTurn,
        isActivitySliceClosed: turn.liveActivity.isActivitySliceClosed,
        isExploring: turn.liveActivity.state === "exploring",
        reasoningFallbackLabel: turn.liveActivity.reasoningSummary?.text,
      },
    },
  ).units;
}

function ThreadTurnWithoutServerStatuses(props: ThreadTurnProps) {
  const agentBodyUnits = buildLiveAgentBodyUnits(props.turn, [], null);

  return (
    <ThreadMcpAppsProvider apps={[]}>
      <ThreadTurnBody {...props} agentBodyUnits={agentBodyUnits} />
    </ThreadMcpAppsProvider>
  );
}

function ThreadTurnWithLiveStatuses(props: ThreadTurnProps) {
  const { data: mcpApps } = useCodexMcpApps();
  const { data: mcpServerStatuses } = useMcpServerStatuses();
  const agentBodyUnits = buildLiveAgentBodyUnits(
    props.turn,
    mcpApps ?? [],
    mcpServerStatuses ?? null,
  );

  return (
    <ThreadMcpAppsProvider apps={mcpApps ?? []}>
      <ThreadTurnBody {...props} agentBodyUnits={agentBodyUnits} />
    </ThreadMcpAppsProvider>
  );
}

export function ThreadLiveActivityFallback({ message }: { message?: string | null }) {
  return (
    <div className="min-w-0 py-0">
      <CodexShimmerText className="text-size-chat truncate text-token-foreground/30">
        {message ?? "Thinking"}
      </CodexShimmerText>
    </div>
  );
}

export function ThreadTurn(props: ThreadTurnProps) {
  const turn = normalizeThreadLiveActivity(props.turn);
  const hasMcpActivity = turn.agentActivitySourceItems.some(
    (item) => item.type === "mcpToolCall",
  );
  if (!hasMcpActivity) {
    return <ThreadTurnWithoutServerStatuses {...props} turn={turn} />;
  }
  return <ThreadTurnWithLiveStatuses {...props} turn={turn} />;
}
