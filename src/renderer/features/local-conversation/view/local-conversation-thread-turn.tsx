import { Fragment, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/shared/icons";
import { cn } from "../../../lib/utils";
import type { ThreadAgentEntryModel, ThreadTurnModel } from "../thread-stage-types";
import { MeasuredExpand } from "./shared/measured-expand";
import { ThreadBlockRenderer } from "./blocks/local-conversation-block-renderer";

interface ThreadTurnProps {
  turn: ThreadTurnModel;
  agentBodyCollapsed: boolean;
  hasPersistedAgentBodyCollapsedState: boolean;
  isMatched: boolean;
  matchedSearchUnitKeys?: ReadonlySet<string>;
  activeSearchUnitKey?: string | null;
  onAgentBodyCollapsedChange: (turnId: string, collapsed: boolean) => void;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onEditLastUserTurn?: (input: { threadId: string; turnId: string; message: string }) => void | Promise<void>;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
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
    <Fragment key={`${block.id}:${index}`}>
      {index > 0 ? <ThreadGap /> : null}
      {renderBlock(block, index)}
    </Fragment>
  ));
}

export function ThreadTurn({
  turn,
  agentBodyCollapsed,
  hasPersistedAgentBodyCollapsedState,
  isMatched,
  matchedSearchUnitKeys,
  activeSearchUnitKey,
  onAgentBodyCollapsedChange,
  projectWorkspacePath,
  threadCwd,
  onEditLastUserTurn,
  onForkFromTurn,
}: ThreadTurnProps) {
  const shouldAllowAgentBodyCollapse =
    turn.hasRenderableAgentBodyEntries
    && (!turn.isLatestTurn || hasPersistedAgentBodyCollapsedState);
  const effectiveAgentBodyCollapsed = shouldAllowAgentBodyCollapse ? agentBodyCollapsed : false;
  const showFinalAssistantDivider =
    shouldAllowAgentBodyCollapse
    && !effectiveAgentBodyCollapsed
    && !turn.workedForTimeLabel
    && turn.trailingBlocks.some((block) => "entry" in block && block.type === "assistantMessage");

  const renderBlock = (block: ThreadTurnModel["blocks"][number], index: number) => (
    <ThreadBlockRenderer
      key={`${turn.turnId}:${block.type}:${index}`}
      block={block}
      isLatestTurn={turn.isLatestTurn}
      isStreamingTurn={turn.isStreamingTurn}
      isSearchMatch={Boolean("searchUnitKey" in block && block.searchUnitKey && matchedSearchUnitKeys?.has(block.searchUnitKey))}
      isActiveSearchMatch={Boolean("searchUnitKey" in block && block.searchUnitKey && activeSearchUnitKey === block.searchUnitKey)}
      projectWorkspacePath={projectWorkspacePath}
      threadCwd={threadCwd}
      onEditLastUserTurn={onEditLastUserTurn}
      onForkFromTurn={onForkFromTurn}
    />
  );

  const renderAgentEntry = (block: ThreadAgentEntryModel, index: number) => (
    <ThreadBlockRenderer
      key={`${turn.turnId}:agent:${block.type}:${index}`}
      block={block}
      isLatestTurn={turn.isLatestTurn}
      isStreamingTurn={turn.isStreamingTurn}
      projectWorkspacePath={projectWorkspacePath}
      threadCwd={threadCwd}
      onEditLastUserTurn={onEditLastUserTurn}
      onForkFromTurn={onForkFromTurn}
    />
  );

  return (
    <div data-content-search-turn-key={turn.turnId}>
      <div className={cn("flex flex-col gap-0", isMatched && "rounded-2xl bg-token-foreground/3")}>
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
                  workedForTimeLabel={turn.workedForTimeLabel}
                  collapsed={effectiveAgentBodyCollapsed}
                  onToggle={() => onAgentBodyCollapsedChange(turn.turnId, !effectiveAgentBodyCollapsed)}
                />
              ) : null}
              {effectiveAgentBodyCollapsed ? null : (
                <MeasuredExpand
                  open
                  className={shouldAllowAgentBodyCollapse ? undefined : "overflow-visible"}
                  innerClassName={shouldAllowAgentBodyCollapse ? "pt-[var(--conversation-tool-assistant-gap,8px)]" : undefined}
                >
                  <div className="flex flex-col gap-0">
                    {renderSpacedBlocks(
                      turn.agentBodyEntries.filter((entry) => !("entry" in entry && entry.type === "workedFor")),
                      renderAgentEntry,
                    )}
                  </div>
                </MeasuredExpand>
              )}
            </div>
          </>
        ) : null}

        {turn.trailingBlocks.length > 0 ? (
          <>
            {(turn.leadingBlocks.length > 0 || turn.agentBodyEntries.length > 0) ? <ThreadGap /> : null}
            <div className="flex flex-col">
              {showFinalAssistantDivider ? <FinalAssistantDividerRow /> : null}
              {showFinalAssistantDivider && turn.trailingBlocks.length > 0 ? <ThreadGap /> : null}
              {renderSpacedBlocks(turn.trailingBlocks, renderBlock)}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
