import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/utils";
import type { ThreadTurnModel } from "../thread-stage-types";
import {
  buildVirtualizedTurnLayout,
  resolveVisibleTurnRange,
} from "./local-conversation-turn-virtualization";
import { useLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";
import { ThreadTurn } from "./local-conversation-thread-turn";

const DEFAULT_TURN_HEIGHT_PX = 280;
const TURN_GAP_PX = 12;
const OVERSCAN_TURNS = 6;

export interface VirtualizedTurnListHandle {
  scrollToTurn: (turnId: string, opts?: { expandAgentBody?: boolean }) => void;
  scrollToLatest: () => void;
  setAgentBodyCollapsed: (turnId: string, collapsed: boolean) => void;
}

interface VirtualizedTurnListProps {
  turns: ThreadTurnModel[];
  collapsedAgentBodyByTurnId: Readonly<Record<string, boolean>>;
  matchedTurnIds?: ReadonlySet<string>;
  matchedSearchUnitKeys?: ReadonlySet<string>;
  activeSearchUnitKey?: string | null;
  onAgentBodyCollapsedChange: (turnId: string, collapsed: boolean) => void;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  className?: string;
  onEditLastUserTurn?: (input: { threadId: string; turnId: string; message: string }) => void | Promise<void>;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
}

function MeasuredTurn({
  turn,
  turnIndex,
  onHeightChange,
  agentBodyCollapsed,
  hasPersistedAgentBodyCollapsedState,
  onAgentBodyCollapsedChange,
  isMatched,
  matchedSearchUnitKeys,
  activeSearchUnitKey,
  projectWorkspacePath,
  threadCwd,
  onEditLastUserTurn,
  onForkFromTurn,
}: {
  turn: ThreadTurnModel;
  turnIndex: number;
  onHeightChange: (turnId: string, turnIndex: number, nextHeight: number) => void;
  agentBodyCollapsed: boolean;
  hasPersistedAgentBodyCollapsedState: boolean;
  onAgentBodyCollapsedChange: (turnId: string, collapsed: boolean) => void;
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
    onHeightChange(turn.turnId, turnIndex, element.offsetHeight);
  }, [onHeightChange, turn.turnId, turnIndex]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let frameHandle: number | null = null;
    const measureHeight = () => {
      onHeightChange(turn.turnId, turnIndex, element.offsetHeight);
    };
    const scheduleMeasure = () => {
      if (frameHandle !== null) return;
      frameHandle = window.requestAnimationFrame(() => {
        frameHandle = null;
        measureHeight();
      });
    };

    scheduleMeasure();
    const observer = new ResizeObserver(() => {
      scheduleMeasure();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
      }
    };
  }, [onHeightChange, turn.turnId, turnIndex]);

  return (
    <div ref={handleElementRef} data-thread-turn-id={turn.turnId}>
      <ThreadTurn
        turn={turn}
        agentBodyCollapsed={agentBodyCollapsed}
        hasPersistedAgentBodyCollapsedState={hasPersistedAgentBodyCollapsedState}
        isMatched={isMatched}
        matchedSearchUnitKeys={matchedSearchUnitKeys}
        activeSearchUnitKey={activeSearchUnitKey}
        onAgentBodyCollapsedChange={onAgentBodyCollapsedChange}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
        onEditLastUserTurn={onEditLastUserTurn}
        onForkFromTurn={onForkFromTurn}
      />
    </div>
  );
}

function resolveAbsoluteScrollTopPxForElement({
  scrollElement,
  targetElement,
}: {
  scrollElement: HTMLDivElement;
  targetElement: HTMLElement;
}): number {
  const scrollRect = scrollElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  return targetRect.top - scrollRect.top + scrollElement.scrollTop;
}

export const VirtualizedTurnList = forwardRef<VirtualizedTurnListHandle, VirtualizedTurnListProps>(function VirtualizedTurnList({
  turns,
  collapsedAgentBodyByTurnId,
  matchedTurnIds,
  matchedSearchUnitKeys,
  activeSearchUnitKey,
  onAgentBodyCollapsedChange,
  projectWorkspacePath,
  threadCwd,
  className,
  onEditLastUserTurn,
  onForkFromTurn,
}, ref) {
  const {
    adjustForMeasuredTurnHeightDelta,
    jumpToBottom,
    maybeStickToBottom,
    notifyContentLayout,
    scrollElement,
    scrollToTopPx,
    setScrollMode,
  } = useLocalConversationThreadScrollController();
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const [listRoot, setListRoot] = useState<HTMLDivElement | null>(null);
  const listRootRef = useRef<HTMLDivElement | null>(null);
  const turnsTopOffsetPxRef = useRef(0);
  const [viewportState, setViewportState] = useState({
    scrollTopPx: 0,
    viewportHeightPx: 0,
    turnsTopOffsetPx: 0,
  });
  const heightsPx = useMemo(
    () => turns.map((turn) => measuredHeights[turn.turnId] ?? DEFAULT_TURN_HEIGHT_PX),
    [measuredHeights, turns],
  );
  const layout = useMemo(
    () => buildVirtualizedTurnLayout({ heightsPx, gapPx: TURN_GAP_PX }),
    [heightsPx],
  );
  const offsetsByTurnId = useMemo(
    () => new Map(
      turns.map((turn, index) => [
        turn.turnId,
        {
          top: layout.offsetsPx[index] ?? 0,
          height: heightsPx[index] ?? DEFAULT_TURN_HEIGHT_PX,
          index,
        },
      ] as const),
    ),
    [heightsPx, layout.offsetsPx, turns],
  );

  useLayoutEffect(() => {
    if (scrollElement === null || listRoot === null) return;

    const syncViewportState = () => {
      const scrollTopPx = scrollElement.scrollTop;
      const viewportHeightPx = scrollElement.clientHeight;
      const containerRect = scrollElement.getBoundingClientRect();
      const listRect = listRoot.getBoundingClientRect();
      const turnsTopOffsetPx = listRect.top - containerRect.top + scrollTopPx;
      turnsTopOffsetPxRef.current = turnsTopOffsetPx;
      setViewportState((current) => (
        current.scrollTopPx === scrollTopPx
        && current.viewportHeightPx === viewportHeightPx
        && current.turnsTopOffsetPx === turnsTopOffsetPx
          ? current
          : {
              scrollTopPx,
              viewportHeightPx,
              turnsTopOffsetPx,
            }
      ));
    };

    syncViewportState();
    scrollElement.addEventListener("scroll", syncViewportState, { passive: true });
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          syncViewportState();
        });
    observer?.observe(scrollElement);
    observer?.observe(listRoot);

    return () => {
      scrollElement.removeEventListener("scroll", syncViewportState);
      observer?.disconnect();
    };
  }, [listRoot, scrollElement]);

  useLayoutEffect(() => {
    if (scrollElement === null || listRoot === null) return;
    notifyContentLayout();
  }, [listRoot, notifyContentLayout, scrollElement]);

  useLayoutEffect(() => {
    if (scrollElement === null) return;
    maybeStickToBottom();
  }, [layout.totalHeightPx, measuredHeights, maybeStickToBottom, scrollElement, turns.length]);

  const viewportTopPx = Math.max(0, viewportState.scrollTopPx - viewportState.turnsTopOffsetPx);
  const viewportBottomPx = viewportTopPx + viewportState.viewportHeightPx;
  const visibleRange = useMemo(() => {
    if (viewportState.viewportHeightPx <= 0) {
      return { startIndex: 0, endIndex: turns.length };
    }

    return resolveVisibleTurnRange({
      heightsPx,
      gapPx: TURN_GAP_PX,
      viewportTopPx,
      viewportBottomPx,
      overscanCount: OVERSCAN_TURNS,
    });
  }, [heightsPx, turns.length, viewportBottomPx, viewportState.viewportHeightPx, viewportTopPx]);

  const handleHeightChange = useCallback((turnId: string, turnIndex: number, nextHeight: number) => {
    setMeasuredHeights((current) => {
      const previousHeight = current[turnId] ?? DEFAULT_TURN_HEIGHT_PX;
      if (Math.abs(previousHeight - nextHeight) < 1) return current;

      const heightDeltaPx = nextHeight - previousHeight;
      const turnBottomPx = (layout.offsetsPx[turnIndex] ?? 0) + previousHeight;
      const currentViewportTopPx = Math.max(0, viewportState.scrollTopPx - turnsTopOffsetPxRef.current);
      adjustForMeasuredTurnHeightDelta({
        heightDeltaPx,
        turnBottomPx,
        viewportTopPx: currentViewportTopPx,
      });

      return {
        ...current,
        [turnId]: nextHeight,
      };
    });
  }, [adjustForMeasuredTurnHeightDelta, layout.offsetsPx, viewportState.scrollTopPx]);

  const handleListRootRef = useCallback((element: HTMLDivElement | null) => {
    listRootRef.current = element;
    setListRoot(element);
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToTurn(turnId: string, opts?: { expandAgentBody?: boolean }) {
      if (scrollElement === null) return;

      setScrollMode("programmaticFind");

      const finishProgrammaticFind = () => {
        queueMicrotask(() => {
          setScrollMode("user");
        });
      };

      if (opts?.expandAgentBody) {
        onAgentBodyCollapsedChange(turnId, false);
        requestAnimationFrame(() => {
          const targetElement = listRootRef.current?.querySelector<HTMLElement>(`[data-thread-turn-id="${turnId}"]`);
          if (!targetElement) {
            finishProgrammaticFind();
            return;
          }
          scrollToTopPx(
            resolveAbsoluteScrollTopPxForElement({
              scrollElement,
              targetElement,
            }),
            "smooth",
          );
          finishProgrammaticFind();
        });
        return;
      }

      const target = offsetsByTurnId.get(turnId);
      if (!target) {
        finishProgrammaticFind();
        return;
      }

      scrollToTopPx(viewportState.turnsTopOffsetPx + target.top, "smooth");
      finishProgrammaticFind();
    },
    scrollToLatest() {
      jumpToBottom();
    },
    setAgentBodyCollapsed(turnId: string, collapsed: boolean) {
      onAgentBodyCollapsedChange(turnId, collapsed);
    },
  }), [jumpToBottom, offsetsByTurnId, onAgentBodyCollapsedChange, scrollElement, scrollToTopPx, setScrollMode, viewportState.turnsTopOffsetPx]);

  const visibleTurns = turns.slice(visibleRange.startIndex, visibleRange.endIndex);
  const topSpacerHeightPx = layout.offsetsPx[visibleRange.startIndex] ?? 0;
  const visibleHeightsPx = heightsPx.slice(visibleRange.startIndex, visibleRange.endIndex);
  const visibleBlockHeightPx =
    visibleHeightsPx.reduce((sum, heightPx) => sum + heightPx, 0)
    + Math.max(0, visibleHeightsPx.length - 1) * TURN_GAP_PX;
  const bottomSpacerHeightPx = Math.max(0, layout.totalHeightPx - topSpacerHeightPx - visibleBlockHeightPx);

  return (
    <div ref={handleListRootRef} className={cn("relative", className)}>
      {topSpacerHeightPx > 0 ? (
        <div aria-hidden="true" style={{ height: `${topSpacerHeightPx}px` }} />
      ) : null}
      <div className="flex flex-col gap-3">
        {visibleTurns.map((turn, index) => (
          <MeasuredTurn
            key={turn.turnId}
            turn={turn}
            turnIndex={visibleRange.startIndex + index}
            onHeightChange={handleHeightChange}
            agentBodyCollapsed={collapsedAgentBodyByTurnId[turn.turnId] ?? turn.defaultAgentBodyCollapsed}
            hasPersistedAgentBodyCollapsedState={Object.hasOwn(collapsedAgentBodyByTurnId, turn.turnId)}
            onAgentBodyCollapsedChange={onAgentBodyCollapsedChange}
            isMatched={matchedTurnIds?.has(turn.turnId) ?? false}
            matchedSearchUnitKeys={matchedSearchUnitKeys}
            activeSearchUnitKey={activeSearchUnitKey}
            projectWorkspacePath={projectWorkspacePath}
            threadCwd={threadCwd}
            onEditLastUserTurn={onEditLastUserTurn}
            onForkFromTurn={onForkFromTurn}
          />
        ))}
      </div>
      {bottomSpacerHeightPx > 0 ? (
        <div aria-hidden="true" style={{ height: `${bottomSpacerHeightPx}px` }} />
      ) : null}
    </div>
  );
});
