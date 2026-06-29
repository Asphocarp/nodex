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
  buildVirtualizedTurnListRestoreState,
  DEFAULT_VIRTUALIZED_TURN_HEIGHT_PX,
  resolveAnchorPreservedDistanceFromBottom,
  resolveInitialVirtualizedTurnViewportState,
  resolveMeasuredVisibleAnchorKey,
  resolveResponseSpacerBottomViewportOverflowPx,
  resolveResponseSpacerHeightPx,
  resolveRenderedRangeFromAnchor,
  resolveRenderedRangeForPendingScrollTarget,
  resolveTargetCenterDistanceFromBottom,
  resolveThreadLatestTurnFollowState,
  resolveThreadLatestTurnPhase,
  resolveTurnCenterDistanceFromBottom,
  resolveVirtualizedTurnViewportState,
  THREAD_NEAR_BOTTOM_THRESHOLD_PX,
  type VirtualizedLatestTurnRestoreState,
  type ThreadLatestTurnFollowState,
  type VirtualizedTurnListRestoreState,
  type VirtualizedTurnViewportState,
} from "./local-conversation-turn-virtualization";
import { useLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";
import { LocalConversationTurnEntry } from "./local-conversation-turn-entry";

const TURN_GAP_PX = 12;
const OVERSCAN_TURNS = 6;
const COLLAPSED_VISIBLE_TURNS = 3;

function readScrollPaddingBottomPx(element: HTMLElement | null): number {
  if (element === null || typeof window === "undefined") return 0;
  const value = window.getComputedStyle(element).scrollPaddingBottom;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readCodexWindowZoom(element: HTMLElement | null): number {
  if (element === null || typeof window === "undefined") return 1;
  const value = window.getComputedStyle(element).getPropertyValue("--codex-window-zoom");
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

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
  scrollToKey: (
    turnKey: string,
    getTargetElement?: LocalConversationVirtualizedTurnTargetResolver,
  ) => Promise<void>;
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
  initialRestoreState?: VirtualizedTurnListRestoreState | null;
  initialLatestTurnRestoreState?: VirtualizedLatestTurnRestoreState | null;
  onRestoreStateChange?: (state: VirtualizedTurnListRestoreState | null) => void;
  onLatestTurnRestoreStateChange?: (state: VirtualizedLatestTurnRestoreState | null) => void;
  onVisibleContentReady?: () => void;
  latestTurnSynchronousMeasurementKey?: string | number;
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
    <div
      ref={handleElementRef}
      data-thread-turn-id={entry.turnKey}
      data-turn-key={entry.turnKey}
    >
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
  initialRestoreState = null,
  initialLatestTurnRestoreState = null,
  onRestoreStateChange,
  onLatestTurnRestoreStateChange,
  onVisibleContentReady,
  latestTurnSynchronousMeasurementKey,
  scrollElement,
  className,
}: LocalConversationVirtualizedTurnListProps) {
  const {
    adjustForMeasuredTurnHeightDelta,
    addScrollListener,
    consumePendingLatestTurnSubmitPlacement,
    getScrollDistanceFromBottomPx,
    maybeStickToBottom,
    notifyContentLayout,
    registerResponseSpacerState,
    scrollToBottom,
    scrollToDistanceFromBottomPx,
    setScrollMode,
    getScrollMode,
  } = useLocalConversationThreadScrollController();
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>(
    () => initialRestoreState?.turnHeightsByKey ?? {},
  );
  const [listRoot, setListRoot] = useState<HTMLDivElement | null>(null);
  const initialLatestTurnKey = entries[entries.length - 1]?.turnKey ?? null;
  const [responseSpacerHeightPx, setResponseSpacerHeightPx] = useState(0);
  const [latestTurnFollowState, setLatestTurnFollowState] =
    useState<ThreadLatestTurnFollowState>(() =>
      initialLatestTurnRestoreState?.turnKey === initialLatestTurnKey
        ? initialLatestTurnRestoreState.followState
        : { followMode: "static" },
    );
  const turnsBottomInsetPxRef = useRef(0);
  const layoutRef = useRef(
    buildVirtualizedTurnLayout({
      entries,
      gapPx: TURN_GAP_PX,
      measuredHeightsByKey: initialRestoreState?.turnHeightsByKey ?? {},
    }),
  );
  const scrollDistanceFromBottomPxRef = useRef(0);
  const [viewportState, setViewportState] = useState({
    scrollDistanceFromBottomPx: 0,
    viewportHeightPx: 0,
    turnsBottomInsetPx: 0,
  });
  const [virtualViewportState, setVirtualViewportState] = useState<VirtualizedTurnViewportState>(
    () =>
      resolveInitialVirtualizedTurnViewportState({
        distanceFromBottomPx: 0,
        initialRestoreState,
        layout: layoutRef.current,
        overscanCount: OVERSCAN_TURNS,
        viewportHeightPx: 800,
      }),
  );
  const latestVirtualViewportStateRef = useRef(virtualViewportState);
  const measuredHeightsRef = useRef(measuredHeights);
  const pendingScrollResolvers = useRef(new Map<number, () => void>());
  const pendingScrollRequestId = useRef(0);
  const responseSpacerHeightPxRef = useRef(0);
  const latestTurnFollowStateRef = useRef(latestTurnFollowState);
  const latestTurnPhaseRef = useRef(resolveThreadLatestTurnPhase(entries[entries.length - 1]?.turn ?? null));
  const latestTurnKeyRef = useRef(initialLatestTurnKey);
  const [pendingScrollTarget, setPendingScrollTarget] = useState<{
    requestId: number;
    turnKey: string;
    getTargetElement?: LocalConversationVirtualizedTurnTargetResolver;
  } | null>(null);
  const visibleContentReadyRef = useRef(false);

  const layout = useMemo(
    () => buildVirtualizedTurnLayout({
      entries,
      gapPx: TURN_GAP_PX,
      measuredHeightsByKey: measuredHeights,
    }),
    [entries, measuredHeights],
  );

  const previousLayout = layoutRef.current;
  layoutRef.current = layout;
  scrollDistanceFromBottomPxRef.current = viewportState.scrollDistanceFromBottomPx;
  latestVirtualViewportStateRef.current = virtualViewportState;
  measuredHeightsRef.current = measuredHeights;
  responseSpacerHeightPxRef.current = responseSpacerHeightPx;
  latestTurnFollowStateRef.current = latestTurnFollowState;

  const latestTurnEntry = entries[entries.length - 1] ?? null;
  const latestTurnKey = latestTurnEntry?.turnKey ?? null;
  const latestTurnPhase = resolveThreadLatestTurnPhase(latestTurnEntry?.turn ?? null);

  const scrollResponseSpacerToBottom = useCallback(() => {
    setResponseSpacerHeightPx(0);
    setScrollMode("stickToBottom");
    scrollToBottom();
  }, [scrollToBottom, setScrollMode]);

  useEffect(() => {
    if (responseSpacerHeightPx <= 0) {
      registerResponseSpacerState(null);
      return () => {
        registerResponseSpacerState(null);
      };
    }

    registerResponseSpacerState({
      getHeightPx: () => responseSpacerHeightPxRef.current,
      scrollToBottom: scrollResponseSpacerToBottom,
    });
    return () => {
      registerResponseSpacerState(null);
    };
  }, [
    registerResponseSpacerState,
    responseSpacerHeightPx,
    scrollResponseSpacerToBottom,
  ]);

  useEffect(
    () => addScrollListener((distanceFromBottomPx) => {
      setLatestTurnFollowState((current) =>
        resolveThreadLatestTurnFollowState(current, {
          type: "scroll_distance_changed",
          distanceFromBottomPx,
          latestTurnPhase: latestTurnPhaseRef.current,
        }),
      );
      if (distanceFromBottomPx > THREAD_NEAR_BOTTOM_THRESHOLD_PX) return;
      setResponseSpacerHeightPx(0);
    }),
    [addScrollListener],
  );

  useEffect(() => {
    const previousLatestTurnPhase = latestTurnPhaseRef.current;
    if (previousLatestTurnPhase === latestTurnPhase) return;
    latestTurnPhaseRef.current = latestTurnPhase;

    setLatestTurnFollowState((current) => {
      const next = resolveThreadLatestTurnFollowState(current, {
        type: "latest_turn_phase_changed",
        latestTurnPhase,
        previousLatestTurnPhase,
      });
      if (
        current.followMode === "prework_follow"
        && next.followMode === "user_follow"
      ) {
        scrollResponseSpacerToBottom();
      }
      return next;
    });
  }, [latestTurnPhase, scrollResponseSpacerToBottom]);

  useLayoutEffect(() => {
    const previousLatestTurnKey = latestTurnKeyRef.current;
    if (previousLatestTurnKey === latestTurnKey) return;
    latestTurnKeyRef.current = latestTurnKey;

    if (latestTurnKey === null) {
      setResponseSpacerHeightPx(0);
      setLatestTurnFollowState((current) =>
        resolveThreadLatestTurnFollowState(current, { type: "latest_turn_removed" }),
      );
      return;
    }

    const placement = consumePendingLatestTurnSubmitPlacement();
    setLatestTurnFollowState((current) =>
      resolveThreadLatestTurnFollowState(current, { type: "latest_turn_placed" }),
    );
    if (placement === null) return;

    if (!placement.shouldPlaceLatestTurn) {
      setResponseSpacerHeightPx(0);
      setScrollMode("user");
      scrollToDistanceFromBottomPx(placement.distanceFromBottomPx, "auto");
      return;
    }

    const responseSpacerHeightPx = resolveResponseSpacerHeightPx({
      scrollPaddingBottomPx: readScrollPaddingBottomPx(scrollElement),
      viewportHeightPx: scrollElement?.clientHeight ?? viewportState.viewportHeightPx,
    });
    setResponseSpacerHeightPx(responseSpacerHeightPx);
    setScrollMode("stickToBottom");
    scrollToDistanceFromBottomPx(0, "auto");
  }, [
    consumePendingLatestTurnSubmitPlacement,
    latestTurnKey,
    scrollElement,
    scrollToDistanceFromBottomPx,
    setScrollMode,
    viewportState.viewportHeightPx,
  ]);

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
      const listViewportBottomDistanceFromBottomPx = Math.max(
        0,
        scrollDistanceFromBottomPx - turnsBottomInsetPx,
      );
      turnsBottomInsetPxRef.current = turnsBottomInsetPx;
      setVirtualViewportState((current) =>
        resolveVirtualizedTurnViewportState({
          current,
          distanceFromBottomPx: listViewportBottomDistanceFromBottomPx,
          layout,
          overscanCount: OVERSCAN_TURNS,
          viewportHeightPx,
        }),
      );
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
  }, [getScrollDistanceFromBottomPx, layout, listRoot, scrollElement]);

  useLayoutEffect(() => {
    if (scrollElement === null || listRoot === null) return;
    notifyContentLayout();
  }, [listRoot, notifyContentLayout, scrollElement]);

  useLayoutEffect(() => {
    if (scrollElement === null) return;
    maybeStickToBottom();
  }, [entries.length, layout.totalHeightPx, measuredHeights, maybeStickToBottom, scrollElement]);

  useLayoutEffect(() => {
    if (scrollElement === null || previousLayout === layout) return;

    const listViewportBottomDistanceFromBottomPx = Math.max(
      0,
      scrollDistanceFromBottomPxRef.current - turnsBottomInsetPxRef.current,
    );
    const anchorKey = resolveMeasuredVisibleAnchorKey({
      distanceFromBottomPx: listViewportBottomDistanceFromBottomPx,
      layout: previousLayout,
      measuredHeightsByKey: measuredHeights,
      nextLayout: layout,
      viewportHeightPx: viewportState.viewportHeightPx,
    });
    const preservedDistanceFromBottomPx = anchorKey
      ? resolveAnchorPreservedDistanceFromBottom({
          anchorKey,
          distanceFromBottomPx: listViewportBottomDistanceFromBottomPx,
          previousLayout,
          nextLayout: layout,
        })
      : null;

    setVirtualViewportState((current) =>
      {
        const anchorKey = current.turnKeys[current.renderedRange.startIndex];
        const anchorRange = anchorKey && current.turnKeys.join("\u0000") !== layout.turnKeys.join("\u0000")
          ? resolveRenderedRangeFromAnchor({
              anchorKey,
              layout,
              previousRange: current.renderedRange,
            })
          : null;
        return resolveVirtualizedTurnViewportState({
          current: anchorRange ? { ...current, renderedRange: anchorRange } : current,
          distanceFromBottomPx: preservedDistanceFromBottomPx ?? listViewportBottomDistanceFromBottomPx,
          layout,
          overscanCount: OVERSCAN_TURNS,
          viewportHeightPx: viewportState.viewportHeightPx,
        });
      },
    );

    if (preservedDistanceFromBottomPx !== null) {
      scrollToDistanceFromBottomPx(
        turnsBottomInsetPxRef.current + preservedDistanceFromBottomPx,
        "auto",
      );
    }
  }, [
    layout,
    measuredHeights,
    previousLayout,
    scrollElement,
    scrollToDistanceFromBottomPx,
    viewportState.viewportHeightPx,
  ]);

  const visibleRange = useMemo(() => {
    if (scrollElement === null) {
      return {
        startIndex: Math.max(0, entries.length - COLLAPSED_VISIBLE_TURNS),
        endIndex: entries.length,
      };
    }
    if (!pendingScrollTarget) return virtualViewportState.renderedRange;

    return resolveRenderedRangeForPendingScrollTarget({
      currentRange: virtualViewportState.renderedRange,
      layout,
      overscanCount: OVERSCAN_TURNS,
      pendingTurnKey: pendingScrollTarget.turnKey,
      viewportHeightPx: viewportState.viewportHeightPx,
    });
  }, [
    entries.length,
    layout,
    pendingScrollTarget,
    scrollElement,
    viewportState.viewportHeightPx,
    virtualViewportState.renderedRange,
  ]);

  const handleHeightChange = useCallback(
    (turnKey: string, turnIndex: number, nextHeight: number) => {
      setMeasuredHeights((current) => {
        const previousHeight = current[turnKey] ?? DEFAULT_VIRTUALIZED_TURN_HEIGHT_PX;
        if (Math.abs(previousHeight - nextHeight) < 1) return current;

        const heightDeltaPx = nextHeight - previousHeight;
        const turnTopDistanceFromBottomPx =
          (layoutRef.current.bottomOffsetsPx[turnIndex] ?? 0) + previousHeight;
        const currentViewportBottomDistanceFromBottomPx = Math.max(
          0,
          scrollDistanceFromBottomPxRef.current - turnsBottomInsetPxRef.current,
        );
        adjustForMeasuredTurnHeightDelta({
          heightDeltaPx,
          turnTopDistanceFromBottomPx,
          viewportBottomDistanceFromBottomPx: currentViewportBottomDistanceFromBottomPx,
        });

        if (
          turnKey === latestTurnKeyRef.current
        ) {
          const latestTurnPhase = latestTurnPhaseRef.current;
          const followContentOverflowPx = resolveResponseSpacerBottomViewportOverflowPx({
            distanceFromBottomPx: scrollDistanceFromBottomPxRef.current,
            responseSpacerHeightPx: responseSpacerHeightPxRef.current,
            scrollPaddingBottomPx: readScrollPaddingBottomPx(scrollElement),
          });
          const nextFollowState = resolveThreadLatestTurnFollowState(
            latestTurnFollowStateRef.current,
            {
              type: "latest_turn_follow_content_changed",
              followContentOverflowPx,
              latestTurnPhase,
            },
          );
          latestTurnFollowStateRef.current = nextFollowState;
          setLatestTurnFollowState(nextFollowState);

          if (
            getScrollMode() === "stickToBottom"
            || nextFollowState.followMode === "prework_follow"
            || nextFollowState.followMode === "user_follow"
          ) {
            scrollToDistanceFromBottomPx(0, "auto");
          }
        }

        return {
          ...current,
          [turnKey]: nextHeight,
        };
      });
    },
    [
      adjustForMeasuredTurnHeightDelta,
      getScrollMode,
      scrollElement,
      scrollToDistanceFromBottomPx,
    ],
  );

  useLayoutEffect(() => {
    if (latestTurnSynchronousMeasurementKey == null || listRoot === null) return;
    const latestTurnKey = entries[entries.length - 1]?.turnKey;
    if (!latestTurnKey) return;

    const latestTurnElement = Array.from(
      listRoot.querySelectorAll<HTMLElement>("[data-thread-turn-id]"),
    ).find((element) => element.dataset.threadTurnId === latestTurnKey);
    if (!latestTurnElement) return;
    handleHeightChange(latestTurnKey, entries.length - 1, latestTurnElement.offsetHeight);
  }, [
    entries,
    handleHeightChange,
    latestTurnSynchronousMeasurementKey,
    listRoot,
  ]);

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
      getTargetElement?: LocalConversationVirtualizedTurnTargetResolver,
    ) => {
      pendingScrollRequestId.current += 1;
      const requestId = pendingScrollRequestId.current;

      return new Promise<void>((resolve) => {
        pendingScrollResolvers.current.set(requestId, resolve);
        setScrollMode("programmaticFind");
        setPendingScrollTarget({
          requestId,
          turnKey,
          getTargetElement,
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

  useLayoutEffect(() => {
    if (!onRestoreStateChange) return;
    onRestoreStateChange(
      buildVirtualizedTurnListRestoreState({
        measuredHeightsByKey: measuredHeights,
        renderedRange: virtualViewportState.renderedRange,
        turnKeys: layout.turnKeys,
      }),
    );
  }, [
    layout.turnKeys,
    measuredHeights,
    onRestoreStateChange,
    virtualViewportState.renderedRange,
  ]);

  useLayoutEffect(() => {
    if (!onLatestTurnRestoreStateChange) return;
    if (latestTurnKey === null) {
      onLatestTurnRestoreStateChange(null);
      return;
    }

    onLatestTurnRestoreStateChange({
      followState: latestTurnFollowState,
      latestTurnFollowContentHeightPx:
        responseSpacerHeightPx > 0 ? responseSpacerHeightPx : null,
      latestTurnHeightPx: measuredHeights[latestTurnKey] ?? null,
      turnKey: latestTurnKey,
    });
  }, [
    latestTurnFollowState,
    latestTurnKey,
    measuredHeights,
    onLatestTurnRestoreStateChange,
    responseSpacerHeightPx,
  ]);

  useLayoutEffect(() => {
    if (!onVisibleContentReady || visibleContentReadyRef.current) return;
    if (entries.length > 0 && listRoot === null) return;

    let cancelled = false;
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        visibleContentReadyRef.current = true;
        onVisibleContentReady();
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [entries.length, listRoot, onVisibleContentReady]);

  useEffect(
    () => () => {
      for (const resolve of pendingScrollResolvers.current.values()) {
        resolve();
      }
      pendingScrollResolvers.current.clear();
      onRestoreStateChange?.(
        buildVirtualizedTurnListRestoreState({
          measuredHeightsByKey: measuredHeightsRef.current,
          renderedRange: latestVirtualViewportStateRef.current.renderedRange,
          turnKeys: layoutRef.current.turnKeys,
        }),
      );
    },
    [onRestoreStateChange],
  );

  useLayoutEffect(() => {
    if (!pendingScrollTarget || scrollElement === null) return;

    const index = layout.turnIndexByKey.get(pendingScrollTarget.turnKey);
    if (index == null) {
      finishPendingScroll(pendingScrollTarget.requestId);
      return;
    }

    const turnElement = listRoot?.querySelector<HTMLElement>(
      `[data-thread-turn-id="${pendingScrollTarget.turnKey}"]`,
    );

    if (!turnElement && (index < visibleRange.startIndex || index >= visibleRange.endIndex)) {
      setVirtualViewportState((current) => ({
        ...current,
        renderedRange: resolveRenderedRangeForPendingScrollTarget({
          currentRange: current.renderedRange,
          layout,
          overscanCount: OVERSCAN_TURNS,
          pendingTurnKey: pendingScrollTarget.turnKey,
          viewportHeightPx: viewportState.viewportHeightPx,
        }),
      }));
      return;
    }

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
              windowZoom: readCodexWindowZoom(scrollElement),
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
        "auto",
      );
      setVirtualViewportState((current) =>
        resolveVirtualizedTurnViewportState({
          current,
          distanceFromBottomPx: targetDistanceFromBottomPx,
          layout,
          overscanCount: OVERSCAN_TURNS,
          viewportHeightPx: scrollElement.clientHeight,
        }),
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
      "auto",
    );
    setVirtualViewportState((current) =>
      resolveVirtualizedTurnViewportState({
        current,
        distanceFromBottomPx: targetDistanceFromBottomPx,
        layout,
        overscanCount: OVERSCAN_TURNS,
        viewportHeightPx: scrollElement.clientHeight,
      }),
    );
    finishPendingScroll(pendingScrollTarget.requestId);
  }, [
    finishPendingScroll,
    layout,
    listRoot,
    pendingScrollTarget,
    scrollElement,
    scrollToDistanceFromBottomPx,
    visibleRange.endIndex,
    visibleRange.startIndex,
    viewportState.turnsBottomInsetPx,
    viewportState.viewportHeightPx,
  ]);

  const visibleEntries = entries.slice(
    visibleRange.startIndex,
    visibleRange.endIndex,
  );
  const topSpacerHeightPx = layout.topOffsetsPx[visibleRange.startIndex] ?? 0;

  return (
    <>
      <div
        ref={setListRoot}
        className={cn("relative shrink-0", className)}
        style={{ height: `${layout.totalHeightPx}px` }}
      >
        <div
          className="flex flex-col gap-3"
          style={{ marginTop: `${topSpacerHeightPx}px` }}
        >
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
      </div>
      {responseSpacerHeightPx > 0 ? (
        <div
          aria-hidden="true"
          className="shrink-0"
          style={{ height: `${responseSpacerHeightPx}px` }}
        />
      ) : null}
    </>
  );
}
