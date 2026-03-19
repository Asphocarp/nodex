import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/utils";
import type { ThreadTurnModel } from "../thread-stage-types";
import { ThreadTurn } from "./local-conversation-thread-turn";

const DEFAULT_TURN_HEIGHT_PX = 220;
const OVERSCAN_TURNS = 6;

export interface VirtualizedTurnListHandle {
  scrollToTurn: (turnId: string, opts?: { expandAgentBody?: boolean }) => void;
  scrollToLatest: () => void;
  setAgentBodyCollapsed: (turnId: string, collapsed: boolean) => void;
}

interface VirtualizedTurnListProps {
  turns: ThreadTurnModel[];
  scrollTop: number;
  viewportHeight: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  collapsedAgentBodyByTurnId: Readonly<Record<string, boolean>>;
  collapsedToolItemIds: ReadonlySet<string>;
  matchedTurnIds?: ReadonlySet<string>;
  matchedSearchUnitKeys?: ReadonlySet<string>;
  activeSearchUnitKey?: string | null;
  onAgentBodyCollapsedChange: (turnId: string, collapsed: boolean) => void;
  onToolCollapsedChange: (itemId: string, collapsed: boolean) => void;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  className?: string;
  onEditLastUserTurn?: (input: { threadId: string; turnId: string; message: string }) => void | Promise<void>;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
}

function MeasuredTurn({
  turn,
  top,
  onHeightChange,
  agentBodyCollapsed,
  hasPersistedAgentBodyCollapsedState,
  onAgentBodyCollapsedChange,
  collapsedToolItemIds,
  onToolCollapsedChange,
  isMatched,
  matchedSearchUnitKeys,
  activeSearchUnitKey,
  projectWorkspacePath,
  threadCwd,
  onEditLastUserTurn,
  onForkFromTurn,
}: {
  turn: ThreadTurnModel;
  top: number;
  onHeightChange: (turnId: string, nextHeight: number) => void;
  agentBodyCollapsed: boolean;
  hasPersistedAgentBodyCollapsedState: boolean;
  onAgentBodyCollapsedChange: (turnId: string, collapsed: boolean) => void;
  collapsedToolItemIds: ReadonlySet<string>;
  onToolCollapsedChange: (itemId: string, collapsed: boolean) => void;
  isMatched: boolean;
  matchedSearchUnitKeys?: ReadonlySet<string>;
  activeSearchUnitKey?: string | null;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onEditLastUserTurn?: (input: { threadId: string; turnId: string; message: string }) => void | Promise<void>;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  const handleElementRef = useCallback((element: HTMLDivElement | null) => {
    elementRef.current = element;
    if (!element) return;
    onHeightChange(turn.turnId, element.getBoundingClientRect().height);
  }, [onHeightChange, turn.turnId]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const nextHeight = entries[0]?.contentRect.height;
      if (!nextHeight) return;
      onHeightChange(turn.turnId, nextHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeightChange, turn.turnId]);

  return (
    <div
      ref={handleElementRef}
      data-thread-turn-id={turn.turnId}
      style={{ position: "absolute", top, left: 0, right: 0 }}
    >
      <ThreadTurn
        turn={turn}
        agentBodyCollapsed={agentBodyCollapsed}
        hasPersistedAgentBodyCollapsedState={hasPersistedAgentBodyCollapsedState}
        isMatched={isMatched}
        matchedSearchUnitKeys={matchedSearchUnitKeys}
        activeSearchUnitKey={activeSearchUnitKey}
        collapsedToolItemIds={collapsedToolItemIds}
        onAgentBodyCollapsedChange={onAgentBodyCollapsedChange}
        onToolCollapsedChange={onToolCollapsedChange}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
        onEditLastUserTurn={onEditLastUserTurn}
        onForkFromTurn={onForkFromTurn}
      />
    </div>
  );
}

export const VirtualizedTurnList = forwardRef<VirtualizedTurnListHandle, VirtualizedTurnListProps>(function VirtualizedTurnList({
  turns,
  scrollTop,
  viewportHeight,
  scrollContainerRef,
  collapsedAgentBodyByTurnId,
  collapsedToolItemIds,
  matchedTurnIds,
  matchedSearchUnitKeys,
  activeSearchUnitKey,
  onAgentBodyCollapsedChange,
  onToolCollapsedChange,
  projectWorkspacePath,
  threadCwd,
  className,
  onEditLastUserTurn,
  onForkFromTurn,
}, ref) {
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});

  const offsets = useMemo(() => {
    let nextOffset = 0;
    return turns.map((turn) => {
      const height = measuredHeights[turn.turnId] ?? DEFAULT_TURN_HEIGHT_PX;
      const currentOffset = nextOffset;
      nextOffset += height;
      return { turnId: turn.turnId, top: currentOffset, height };
    });
  }, [measuredHeights, turns]);
  const offsetsByTurnId = useMemo(() => new Map(offsets.map((entry) => [entry.turnId, entry] as const)), [offsets]);

  const totalHeight = offsets[offsets.length - 1]
    ? offsets[offsets.length - 1]!.top + offsets[offsets.length - 1]!.height
    : 0;

  const visibleRange = useMemo(() => {
    if (offsets.length === 0) {
      return { startIndex: 0, endIndex: -1 };
    }

    if (viewportHeight <= 0) {
      return { startIndex: 0, endIndex: offsets.length - 1 };
    }

    const visibleBottom = scrollTop + viewportHeight;
    let startIndex = offsets.findIndex((entry) => entry.top + entry.height >= scrollTop);
    if (startIndex < 0) startIndex = 0;

    let endIndex = offsets.findIndex((entry) => entry.top > visibleBottom);
    if (endIndex < 0) endIndex = offsets.length;

    return {
      startIndex: Math.max(0, startIndex - OVERSCAN_TURNS),
      endIndex: Math.min(offsets.length - 1, endIndex + OVERSCAN_TURNS),
    };
  }, [offsets, scrollTop, viewportHeight]);

  const handleHeightChange = useCallback((turnId: string, nextHeight: number) => {
    setMeasuredHeights((current) => {
      const previousHeight = current[turnId] ?? DEFAULT_TURN_HEIGHT_PX;
      if (Math.abs(previousHeight - nextHeight) < 1) return current;

      const scrollContainer = scrollContainerRef.current;
      const targetOffset = offsetsByTurnId.get(turnId);
      if (scrollContainer && targetOffset && targetOffset.top < scrollContainer.scrollTop) {
        scrollContainer.scrollTop += nextHeight - previousHeight;
      }

      return {
        ...current,
        [turnId]: nextHeight,
      };
    });
  }, [offsetsByTurnId, scrollContainerRef]);

  useImperativeHandle(ref, () => ({
    scrollToTurn(turnId: string, opts?: { expandAgentBody?: boolean }) {
      const container = scrollContainerRef.current;
      if (!container) return;
      if (opts?.expandAgentBody) {
        onAgentBodyCollapsedChange(turnId, false);
        requestAnimationFrame(() => {
          const refreshedContainer = scrollContainerRef.current;
          const targetElement = refreshedContainer?.querySelector<HTMLElement>(`[data-thread-turn-id="${turnId}"]`);
          if (!refreshedContainer || !targetElement) return;
          refreshedContainer.scrollTop = targetElement.offsetTop;
        });
        return;
      }
      const target = offsets.find((entry) => entry.turnId === turnId);
      if (!target) return;
      container.scrollTop = target.top;
    },
    scrollToLatest() {
      const container = scrollContainerRef.current;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
    },
    setAgentBodyCollapsed(turnId: string, collapsed: boolean) {
      onAgentBodyCollapsedChange(turnId, collapsed);
    },
  }), [offsets, onAgentBodyCollapsedChange, scrollContainerRef]);

  const visibleTurns = turns.slice(visibleRange.startIndex, visibleRange.endIndex + 1);

  return (
    <div className={cn("relative", className)} style={{ height: totalHeight }}>
      {visibleTurns.map((turn, index) => {
        const offset = offsets[visibleRange.startIndex + index];
        if (!offset) return null;
        return (
          <MeasuredTurn
            key={turn.turnId}
            turn={turn}
            top={offset.top}
            onHeightChange={handleHeightChange}
            agentBodyCollapsed={collapsedAgentBodyByTurnId[turn.turnId] ?? turn.defaultAgentBodyCollapsed}
            hasPersistedAgentBodyCollapsedState={Object.hasOwn(collapsedAgentBodyByTurnId, turn.turnId)}
            onAgentBodyCollapsedChange={onAgentBodyCollapsedChange}
            collapsedToolItemIds={collapsedToolItemIds}
            onToolCollapsedChange={onToolCollapsedChange}
            isMatched={matchedTurnIds?.has(turn.turnId) ?? false}
            matchedSearchUnitKeys={matchedSearchUnitKeys}
            activeSearchUnitKey={activeSearchUnitKey}
            projectWorkspacePath={projectWorkspacePath}
            threadCwd={threadCwd}
            onEditLastUserTurn={onEditLastUserTurn}
            onForkFromTurn={onForkFromTurn}
          />
        );
      })}
    </div>
  );
});
