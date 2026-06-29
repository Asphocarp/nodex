import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CodexTurnDiffReviewTarget } from "../../../lib/types";
import { cn } from "../../../lib/utils";
import type { VisibleConversationTurnEntry } from "../selectors";
import type { CodexTurnScopedConversationRequest } from "../conversation-request-helpers";
import type { ThreadStageActions } from "../thread-stage-types";
import {
  buildVirtualizedTurnLayout,
  resolveTargetCenterDistanceFromBottom,
  resolveTurnCenterDistanceFromBottom,
  resolveVisibleTurnRangeFromBottomDistance,
} from "./local-conversation-turn-virtualization";
import { useLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";
import { LocalConversationTurnEntry } from "./local-conversation-turn-entry";

const DEFAULT_TURN_HEIGHT_PX = 280;
const TURN_GAP_PX = 12;
const OVERSCAN_TURNS = 6;
const COLLAPSED_VISIBLE_TURNS = 3;

export type LocalConversationVirtualizedTurnTargetResolver =
  (turnElement: HTMLElement) => HTMLElement | null;

export interface LocalConversationVirtualizedTurnListEntry {
  turn: VisibleConversationTurnEntry["turn"];
  turnId: string;
  turnKey: string;
  turnSearchKey: string;
  requests: CodexTurnScopedConversationRequest[];
  isMostRecentTurn: boolean;
}

export interface LocalConversationVirtualizedTurnListApi {
  scrollToKey: {
    (turnKey: string, behavior?: ScrollBehavior): Promise<void>;
    (
      turnKey: string,
      getTargetElement: LocalConversationVirtualizedTurnTargetResolver | undefined,
      behavior?: ScrollBehavior,
    ): Promise<void>;
  };
  setScrollMode: ReturnType<typeof useLocalConversationThreadScrollController>["setScrollMode"];
  getScrollMode: ReturnType<typeof useLocalConversationThreadScrollController>["getScrollMode"];
}

interface LocalConversationVirtualizedTurnListProps {
  entries: LocalConversationVirtualizedTurnListEntry[];
  conversationId: string;
  threadCwd: string | null;
  projectWorkspacePath?: string | null;
  editableTurnId: string | null;
  canForkFromTurn: boolean;
  collapsedAgentBodyByTurnId: Readonly<Record<string, boolean>>;
  onSetTurnCollapsed: (turnId: string, collapsed: boolean) => void;
  onEditLastTurnMessage?: (input: {
    threadId: string;
    turnId: string;
    message: string;
  }) => void | Promise<void>;
  onForkTurnMessage?: (input: {
    threadId: string;
    turnId: string;
    message: string;
    isLatestTurn: boolean;
  }) => void | Promise<void>;
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onOpenThread?: ThreadStageActions["onOpenThread"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
  onApiChange?: (api: LocalConversationVirtualizedTurnListApi | null) => void;
  scrollElement: HTMLDivElement | null;
  className?: string;
}

interface MeasuredTurnProps {
  entry: LocalConversationVirtualizedTurnListEntry;
  turnIndex: number;
  conversationId: string;
  threadCwd: string | null;
  projectWorkspacePath?: string | null;
  persistedCollapsed?: boolean;
  canEditTurnUserPrefix: boolean;
  canForkTurn: boolean;
  onSetTurnCollapsed: (turnId: string, collapsed: boolean) => void;
  onEditLastTurnMessage?: (input: {
    threadId: string;
    turnId: string;
    message: string;
  }) => void | Promise<void>;
  onForkTurnMessage?: (input: {
    threadId: string;
    turnId: string;
    message: string;
    isLatestTurn: boolean;
  }) => void | Promise<void>;
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onOpenThread?: ThreadStageActions["onOpenThread"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
  onHeightChange: (turnKey: string, turnIndex: number, nextHeight: number) => void;
}

function MeasuredTurnComponent({
  entry,
  turnIndex,
  conversationId,
  threadCwd,
  projectWorkspacePath,
  persistedCollapsed,
  canEditTurnUserPrefix,
  canForkTurn,
  onSetTurnCollapsed,
  onEditLastTurnMessage,
  onForkTurnMessage,
  onOpenTurnDiffReview,
  onOpenSideChat,
  onOpenThread,
  onOpenMcpAppSidePanel,
  onHeightChange,
}: MeasuredTurnProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  const handleElementRef = useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element;
      if (!element) return;
      onHeightChange(entry.turnKey, turnIndex, element.offsetHeight);
    },
    [entry.turnKey, onHeightChange, turnIndex],
  );

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    let frameHandle: number | null = null;
    const measureHeight = () => {
      onHeightChange(entry.turnKey, turnIndex, element.offsetHeight);
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
  }, [entry.turnKey, onHeightChange, turnIndex]);

  return (
    <div ref={handleElementRef} data-thread-turn-id={entry.turnKey}>
      <LocalConversationTurnEntry
        conversationId={conversationId}
        turnSearchKey={entry.turnSearchKey}
        turn={entry.turn}
        requests={entry.requests}
        cwd={threadCwd}
        isMostRecentTurn={entry.isMostRecentTurn}
        persistedCollapsed={persistedCollapsed}
        onSetCollapsed={(collapsed) => {
          onSetTurnCollapsed(entry.turnId, collapsed);
        }}
        canEditTurnUserPrefix={canEditTurnUserPrefix}
        canForkTurn={canForkTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
        onEditLastTurnMessage={onEditLastTurnMessage}
        onForkTurnMessage={onForkTurnMessage}
        onOpenTurnDiffReview={onOpenTurnDiffReview}
        onOpenSideChat={onOpenSideChat}
        onOpenThread={onOpenThread}
        onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
      />
    </div>
  );
}

const MeasuredTurn = memo(
  MeasuredTurnComponent,
  (left, right) =>
    left.entry === right.entry
    && left.turnIndex === right.turnIndex
    && left.conversationId === right.conversationId
    && left.threadCwd === right.threadCwd
    && left.projectWorkspacePath === right.projectWorkspacePath
    && left.persistedCollapsed === right.persistedCollapsed
    && left.canEditTurnUserPrefix === right.canEditTurnUserPrefix
    && left.canForkTurn === right.canForkTurn
    && left.onSetTurnCollapsed === right.onSetTurnCollapsed
    && left.onEditLastTurnMessage === right.onEditLastTurnMessage
    && left.onForkTurnMessage === right.onForkTurnMessage
    && left.onOpenTurnDiffReview === right.onOpenTurnDiffReview
    && left.onOpenSideChat === right.onOpenSideChat
    && left.onOpenThread === right.onOpenThread
    && left.onOpenMcpAppSidePanel === right.onOpenMcpAppSidePanel
    && left.onHeightChange === right.onHeightChange,
);

export function LocalConversationVirtualizedTurnList({
  entries,
  conversationId,
  threadCwd,
  projectWorkspacePath,
  editableTurnId,
  canForkFromTurn,
  collapsedAgentBodyByTurnId,
  onSetTurnCollapsed,
  onEditLastTurnMessage,
  onForkTurnMessage,
  onOpenTurnDiffReview,
  onOpenSideChat,
  onOpenThread,
  onOpenMcpAppSidePanel,
  onApiChange,
  scrollElement,
  className,
}: LocalConversationVirtualizedTurnListProps) {
  const {
    adjustForMeasuredTurnHeightDelta,
    getScrollDistanceFromBottomPx,
    maybeStickToBottom,
    notifyContentLayout,
    scrollToDistanceFromBottomPx,
    setScrollMode,
    getScrollMode,
  } = useLocalConversationThreadScrollController();
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const [listRoot, setListRoot] = useState<HTMLDivElement | null>(null);
  const turnsBottomInsetPxRef = useRef(0);
  const layoutBottomOffsetsPxRef = useRef<number[]>([]);
  const scrollDistanceFromBottomPxRef = useRef(0);
  const [viewportState, setViewportState] = useState({
    scrollDistanceFromBottomPx: 0,
    viewportHeightPx: 0,
    turnsBottomInsetPx: 0,
  });
  const pendingScrollResolvers = useRef(new Map<number, () => void>());
  const pendingScrollRequestId = useRef(0);
  const activeScrollRequestId = useRef<number | null>(null);
  const [pendingScrollTarget, setPendingScrollTarget] = useState<{
    requestId: number;
    turnKey: string;
    getTargetElement?: LocalConversationVirtualizedTurnTargetResolver;
    behavior: ScrollBehavior;
  } | null>(null);

  const heightsPx = useMemo(
    () => entries.map((entry) => measuredHeights[entry.turnKey] ?? DEFAULT_TURN_HEIGHT_PX),
    [entries, measuredHeights],
  );
  const layout = useMemo(
    () => buildVirtualizedTurnLayout({ heightsPx, gapPx: TURN_GAP_PX }),
    [heightsPx],
  );
  const entryIndexByTurnKey = useMemo(
    () => new Map(entries.map((entry, index) => [entry.turnKey, index] as const)),
    [entries],
  );

  layoutBottomOffsetsPxRef.current = layout.bottomOffsetsPx;
  scrollDistanceFromBottomPxRef.current = viewportState.scrollDistanceFromBottomPx;

  useLayoutEffect(() => {
    if (scrollElement === null || listRoot === null) return;

    const syncViewportState = () => {
      const scrollDistanceFromBottomPx = getScrollDistanceFromBottomPx();
      const viewportHeightPx = scrollElement.clientHeight;
      const containerRect = scrollElement.getBoundingClientRect();
      const listRect = listRoot.getBoundingClientRect();
      const turnsBottomInsetPx = Math.max(
        0,
        containerRect.bottom - listRect.bottom + scrollDistanceFromBottomPx,
      );
      turnsBottomInsetPxRef.current = turnsBottomInsetPx;
      setViewportState((current) => (
        current.scrollDistanceFromBottomPx === scrollDistanceFromBottomPx
        && current.viewportHeightPx === viewportHeightPx
        && current.turnsBottomInsetPx === turnsBottomInsetPx
          ? current
          : {
              scrollDistanceFromBottomPx,
              viewportHeightPx,
              turnsBottomInsetPx,
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
  }, [getScrollDistanceFromBottomPx, listRoot, scrollElement]);

  useLayoutEffect(() => {
    if (scrollElement === null || listRoot === null) return;
    notifyContentLayout();
  }, [listRoot, notifyContentLayout, scrollElement]);

  useLayoutEffect(() => {
    if (scrollElement === null) return;
    maybeStickToBottom();
  }, [entries.length, layout.totalHeightPx, measuredHeights, maybeStickToBottom, scrollElement]);

  const listViewportBottomDistanceFromBottomPx = Math.max(
    0,
    viewportState.scrollDistanceFromBottomPx - viewportState.turnsBottomInsetPx,
  );
  const visibleRange = useMemo(() => {
    if (scrollElement === null) {
      return {
        startIndex: Math.max(0, entries.length - COLLAPSED_VISIBLE_TURNS),
        endIndex: entries.length,
      };
    }

    return resolveVisibleTurnRangeFromBottomDistance({
      distanceFromBottomPx: listViewportBottomDistanceFromBottomPx,
      layout,
      overscanCount: OVERSCAN_TURNS,
      viewportHeightPx: viewportState.viewportHeightPx,
    });
  }, [
    entries.length,
    layout,
    listViewportBottomDistanceFromBottomPx,
    scrollElement,
    viewportState.viewportHeightPx,
  ]);

  const handleHeightChange = useCallback(
    (turnKey: string, turnIndex: number, nextHeight: number) => {
      setMeasuredHeights((current) => {
        const previousHeight = current[turnKey] ?? DEFAULT_TURN_HEIGHT_PX;
        if (Math.abs(previousHeight - nextHeight) < 1) return current;

        const heightDeltaPx = nextHeight - previousHeight;
        const turnTopDistanceFromBottomPx =
          (layoutBottomOffsetsPxRef.current[turnIndex] ?? 0) + previousHeight;
        const currentViewportBottomDistanceFromBottomPx = Math.max(
          0,
          scrollDistanceFromBottomPxRef.current - turnsBottomInsetPxRef.current,
        );
        adjustForMeasuredTurnHeightDelta({
          heightDeltaPx,
          turnTopDistanceFromBottomPx,
          viewportBottomDistanceFromBottomPx: currentViewportBottomDistanceFromBottomPx,
        });

        return {
          ...current,
          [turnKey]: nextHeight,
        };
      });
    },
    [adjustForMeasuredTurnHeightDelta],
  );

  const finishPendingScroll = useCallback(
    (requestId: number) => {
      queueMicrotask(() => {
        const resolve = pendingScrollResolvers.current.get(requestId);
        pendingScrollResolvers.current.delete(requestId);
        resolve?.();
        setPendingScrollTarget((current) =>
          current?.requestId === requestId ? null : current,
        );
      });
    },
    [],
  );

  const scrollToKey = useCallback(
    (
      turnKey: string,
      getTargetElementOrBehavior?: LocalConversationVirtualizedTurnTargetResolver | ScrollBehavior,
      maybeBehavior?: ScrollBehavior,
    ) => {
      const getTargetElement = typeof getTargetElementOrBehavior === "function"
        ? getTargetElementOrBehavior
        : undefined;
      const behavior = typeof getTargetElementOrBehavior === "string"
        ? getTargetElementOrBehavior
        : maybeBehavior ?? "smooth";
      pendingScrollRequestId.current += 1;
      const requestId = pendingScrollRequestId.current;
      activeScrollRequestId.current = null;

      return new Promise<void>((resolve) => {
        pendingScrollResolvers.current.set(requestId, resolve);
        setScrollMode("programmaticFind");
        setPendingScrollTarget({
          requestId,
          turnKey,
          getTargetElement,
          behavior,
        });
      });
    },
    [setScrollMode],
  );

  useEffect(() => {
    if (!onApiChange) return;
    onApiChange({
      scrollToKey,
      setScrollMode,
      getScrollMode,
    });

    return () => {
      onApiChange(null);
    };
  }, [getScrollMode, onApiChange, scrollToKey, setScrollMode]);

  useEffect(
    () => () => {
      for (const resolve of pendingScrollResolvers.current.values()) {
        resolve();
      }
      pendingScrollResolvers.current.clear();
      activeScrollRequestId.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    if (!pendingScrollTarget || scrollElement === null) return;
    if (activeScrollRequestId.current === pendingScrollTarget.requestId) return;

    const index = entryIndexByTurnKey.get(pendingScrollTarget.turnKey);
    if (index === undefined) {
      finishPendingScroll(pendingScrollTarget.requestId);
      return;
    }

    activeScrollRequestId.current = pendingScrollTarget.requestId;
    const turnElement = listRoot?.querySelector<HTMLElement>(
      `[data-thread-turn-id="${pendingScrollTarget.turnKey}"]`,
    );

    if (turnElement) {
      const targetElement = pendingScrollTarget.getTargetElement?.(turnElement) ?? turnElement;
      const targetDistanceFromBottomPx = pendingScrollTarget.getTargetElement
        ? (() => {
            const turnRect = turnElement.getBoundingClientRect();
            const targetRect = targetElement.getBoundingClientRect();
            return resolveTargetCenterDistanceFromBottom({
              layout,
              targetHeightPx: targetRect.height,
              targetTopWithinTurnPx: targetRect.top - turnRect.top,
              turnIndex: index,
              viewportHeightPx: scrollElement.clientHeight,
            });
          })()
        : resolveTurnCenterDistanceFromBottom({
            layout,
            turnIndex: index,
            viewportHeightPx: scrollElement.clientHeight,
          });

      if (targetDistanceFromBottomPx === null) {
        finishPendingScroll(pendingScrollTarget.requestId);
        return;
      }

      scrollToDistanceFromBottomPx(
        viewportState.turnsBottomInsetPx + targetDistanceFromBottomPx,
        pendingScrollTarget.behavior,
      );
      finishPendingScroll(pendingScrollTarget.requestId);
      return;
    }

    const targetDistanceFromBottomPx = resolveTurnCenterDistanceFromBottom({
      layout,
      turnIndex: index,
      viewportHeightPx: scrollElement.clientHeight,
    });
    if (targetDistanceFromBottomPx === null) {
      finishPendingScroll(pendingScrollTarget.requestId);
      return;
    }
    scrollToDistanceFromBottomPx(
      viewportState.turnsBottomInsetPx + targetDistanceFromBottomPx,
      pendingScrollTarget.behavior,
    );
    finishPendingScroll(pendingScrollTarget.requestId);
  }, [
    entryIndexByTurnKey,
    finishPendingScroll,
    layout,
    listRoot,
    pendingScrollTarget,
    scrollElement,
    scrollToDistanceFromBottomPx,
    viewportState.turnsBottomInsetPx,
  ]);

  const visibleEntries = entries.slice(
    visibleRange.startIndex,
    visibleRange.endIndex,
  );
  const topSpacerHeightPx = layout.topOffsetsPx[visibleRange.startIndex] ?? 0;
  const visibleHeightsPx = heightsPx.slice(
    visibleRange.startIndex,
    visibleRange.endIndex,
  );
  const visibleBlockHeightPx =
    visibleHeightsPx.reduce((sum, heightPx) => sum + heightPx, 0)
    + Math.max(0, visibleHeightsPx.length - 1) * TURN_GAP_PX;
  const bottomSpacerHeightPx = Math.max(
    0,
    layout.totalHeightPx - topSpacerHeightPx - visibleBlockHeightPx,
  );

  return (
    <div className={cn("relative", className)}>
      <div ref={setListRoot}>
        {topSpacerHeightPx > 0 ? (
          <div aria-hidden="true" style={{ height: `${topSpacerHeightPx}px` }} />
        ) : null}
        <div className="flex flex-col gap-3">
          {visibleEntries.map((entry, index) => (
            <MeasuredTurn
              key={entry.turnKey}
              entry={entry}
              turnIndex={visibleRange.startIndex + index}
              conversationId={conversationId}
              threadCwd={threadCwd}
              projectWorkspacePath={projectWorkspacePath}
              persistedCollapsed={collapsedAgentBodyByTurnId[entry.turnId]}
              canEditTurnUserPrefix={editableTurnId === entry.turnId}
              canForkTurn={
                canForkFromTurn && entry.turn.status !== "inProgress"
              }
              onSetTurnCollapsed={onSetTurnCollapsed}
              onEditLastTurnMessage={onEditLastTurnMessage}
              onForkTurnMessage={onForkTurnMessage}
              onOpenTurnDiffReview={onOpenTurnDiffReview}
              onOpenSideChat={onOpenSideChat}
              onOpenThread={onOpenThread}
              onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
              onHeightChange={handleHeightChange}
            />
          ))}
        </div>
        {bottomSpacerHeightPx > 0 ? (
          <div
            aria-hidden="true"
            style={{ height: `${bottomSpacerHeightPx}px` }}
          />
        ) : null}
      </div>
    </div>
  );
}
