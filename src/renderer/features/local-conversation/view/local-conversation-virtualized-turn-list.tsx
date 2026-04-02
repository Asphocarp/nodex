import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/utils";
import {
  buildVirtualizedTurnLayout,
  resolveVisibleTurnRange,
} from "./local-conversation-turn-virtualization";
import { useLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";

const DEFAULT_TURN_HEIGHT_PX = 280;
const TURN_GAP_PX = 12;
const OVERSCAN_TURNS = 6;
const COLLAPSED_VISIBLE_TURNS = 3;

export interface LocalConversationVirtualizedTurnListEntry {
  turnKey: string;
}

export interface LocalConversationVirtualizedTurnListApi {
  scrollToKey: (turnKey: string) => Promise<void>;
  setScrollMode: ReturnType<typeof useLocalConversationThreadScrollController>["setScrollMode"];
  getScrollMode: ReturnType<typeof useLocalConversationThreadScrollController>["getScrollMode"];
}

interface LocalConversationVirtualizedTurnListProps {
  entries: LocalConversationVirtualizedTurnListEntry[];
  renderTurn: (index: number) => ReactNode;
  onApiChange?: (api: LocalConversationVirtualizedTurnListApi | null) => void;
  scrollElement: HTMLDivElement | null;
  className?: string;
}

function resolveAbsoluteScrollTopPxForElement(input: {
  scrollElement: HTMLDivElement;
  targetElement: HTMLElement;
}): number {
  const scrollRect = input.scrollElement.getBoundingClientRect();
  const targetRect = input.targetElement.getBoundingClientRect();
  return targetRect.top - scrollRect.top + input.scrollElement.scrollTop;
}

function MeasuredTurn({
  turnKey,
  turnIndex,
  renderTurn,
  onHeightChange,
}: {
  turnKey: string;
  turnIndex: number;
  renderTurn: (index: number) => ReactNode;
  onHeightChange: (turnKey: string, turnIndex: number, nextHeight: number) => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  const handleElementRef = useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element;
      if (!element) return;
      onHeightChange(turnKey, turnIndex, element.offsetHeight);
    },
    [onHeightChange, turnIndex, turnKey],
  );

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    let frameHandle: number | null = null;
    const measureHeight = () => {
      onHeightChange(turnKey, turnIndex, element.offsetHeight);
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
  }, [onHeightChange, turnIndex, turnKey]);

  return (
    <div ref={handleElementRef} data-thread-turn-id={turnKey}>
      {renderTurn(turnIndex)}
    </div>
  );
}

export function LocalConversationVirtualizedTurnList({
  entries,
  renderTurn,
  onApiChange,
  scrollElement,
  className,
}: LocalConversationVirtualizedTurnListProps) {
  const {
    adjustForMeasuredTurnHeightDelta,
    maybeStickToBottom,
    notifyContentLayout,
    scrollToTopPx,
    setScrollMode,
    getScrollMode,
  } = useLocalConversationThreadScrollController();
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const [listRoot, setListRoot] = useState<HTMLDivElement | null>(null);
  const turnsTopOffsetPxRef = useRef(0);
  const [viewportState, setViewportState] = useState({
    scrollTopPx: 0,
    viewportHeightPx: 0,
    turnsTopOffsetPx: 0,
  });
  const pendingScrollResolvers = useRef(new Map<number, () => void>());
  const pendingScrollRequestId = useRef(0);
  const activeScrollRequestId = useRef<number | null>(null);
  const [pendingScrollTarget, setPendingScrollTarget] = useState<{
    requestId: number;
    turnKey: string;
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
  }, [entries.length, layout.totalHeightPx, measuredHeights, maybeStickToBottom, scrollElement]);

  const viewportTopPx = Math.max(
    0,
    viewportState.scrollTopPx - viewportState.turnsTopOffsetPx,
  );
  const viewportBottomPx = viewportTopPx + viewportState.viewportHeightPx;
  const visibleRange = useMemo(() => {
    if (scrollElement === null) {
      return {
        startIndex: Math.max(0, entries.length - COLLAPSED_VISIBLE_TURNS),
        endIndex: entries.length,
      };
    }

    return resolveVisibleTurnRange({
      heightsPx,
      gapPx: TURN_GAP_PX,
      viewportTopPx,
      viewportBottomPx,
      overscanCount: OVERSCAN_TURNS,
    });
  }, [entries.length, heightsPx, scrollElement, viewportBottomPx, viewportTopPx]);

  const handleHeightChange = useCallback(
    (turnKey: string, turnIndex: number, nextHeight: number) => {
      setMeasuredHeights((current) => {
        const previousHeight = current[turnKey] ?? DEFAULT_TURN_HEIGHT_PX;
        if (Math.abs(previousHeight - nextHeight) < 1) return current;

        const heightDeltaPx = nextHeight - previousHeight;
        const turnBottomPx = (layout.offsetsPx[turnIndex] ?? 0) + previousHeight;
        const currentViewportTopPx = Math.max(
          0,
          viewportState.scrollTopPx - turnsTopOffsetPxRef.current,
        );
        adjustForMeasuredTurnHeightDelta({
          heightDeltaPx,
          turnBottomPx,
          viewportTopPx: currentViewportTopPx,
        });

        return {
          ...current,
          [turnKey]: nextHeight,
        };
      });
    },
    [adjustForMeasuredTurnHeightDelta, layout.offsetsPx, viewportState.scrollTopPx],
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
        setScrollMode("user");
      });
    },
    [setScrollMode],
  );

  const scrollToKey = useCallback(
    (turnKey: string) => {
      pendingScrollRequestId.current += 1;
      const requestId = pendingScrollRequestId.current;
      activeScrollRequestId.current = null;

      return new Promise<void>((resolve) => {
        pendingScrollResolvers.current.set(requestId, resolve);
        setScrollMode("programmaticFind");
        setPendingScrollTarget({ requestId, turnKey });
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
    const targetElement = listRoot?.querySelector<HTMLElement>(
      `[data-thread-turn-id="${pendingScrollTarget.turnKey}"]`,
    );

    if (targetElement) {
      scrollToTopPx(
        resolveAbsoluteScrollTopPxForElement({
          scrollElement,
          targetElement,
        }),
        "smooth",
      );
      finishPendingScroll(pendingScrollTarget.requestId);
      return;
    }

    const topPx =
      viewportState.turnsTopOffsetPx + (layout.offsetsPx[index] ?? 0);
    scrollToTopPx(topPx, "smooth");
    finishPendingScroll(pendingScrollTarget.requestId);
  }, [
    entryIndexByTurnKey,
    finishPendingScroll,
    layout.offsetsPx,
    listRoot,
    pendingScrollTarget,
    scrollElement,
    scrollToTopPx,
    viewportState.turnsTopOffsetPx,
  ]);

  const visibleEntries = entries.slice(
    visibleRange.startIndex,
    visibleRange.endIndex,
  );
  const topSpacerHeightPx = layout.offsetsPx[visibleRange.startIndex] ?? 0;
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
              turnKey={entry.turnKey}
              turnIndex={visibleRange.startIndex + index}
              renderTurn={renderTurn}
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
