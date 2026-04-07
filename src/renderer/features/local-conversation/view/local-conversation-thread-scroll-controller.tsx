import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../../../lib/utils";
import {
  resolveAdjustedScrollTopForMeasuredTurnHeightDelta,
  type MeasuredTurnHeightDeltaInput,
  type ThreadScrollMode,
} from "./local-conversation-turn-virtualization";

const USER_SCROLL_WHEEL_DELTA_THRESHOLD_PX = 12;
const USER_SCROLL_GRACE_WINDOW_MS = 750;
const PROGRAMMATIC_SCROLL_SETTLE_WINDOW_MS = 64;
const NEAR_BOTTOM_THRESHOLD_PX = 24;

export interface ThreadScrollPositionSnapshot {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export interface ThreadScrollModeResolutionInput {
  currentMode: ThreadScrollMode;
  isNearBottom: boolean;
  nowMs: number;
  userScrollGraceUntilMs: number;
  programmaticScrollSettledUntilMs: number;
}

export interface LocalConversationThreadScrollControllerValue {
  isScrolledFromBottom: boolean;
  scrollElement: HTMLDivElement | null;
  notifyContentLayout: () => void;
  suppressAutoStickToBottom: () => void;
  setScrollMode: (mode: ThreadScrollMode) => void;
  getScrollMode: () => ThreadScrollMode;
  maybeStickToBottom: () => void;
  scrollToBottom: () => void;
  jumpToBottom: () => void;
  scrollToTopPx: (topPx: number, behavior?: ScrollBehavior) => void;
  adjustForMeasuredTurnHeightDelta: (input: Omit<MeasuredTurnHeightDeltaInput, "currentScrollTopPx" | "scrollMode">) => void;
}

export interface LocalConversationThreadScrollLayoutHandle {
  scrollToBottom: () => void;
}

interface LocalConversationThreadScrollLayoutProps {
  children: ReactNode;
  scrollViewClassName?: string;
  contentWrapperClassName?: string;
}

interface LocalConversationThreadScrollControllerContextValue
  extends LocalConversationThreadScrollControllerValue {
  registerScrollElement: (element: HTMLDivElement | null) => void;
}

const THREAD_SCROLL_VIEWPORT_CLASS_NAME =
  "relative h-full vertical-scroll-fade-mask-top [--edge-fade-distance:2rem] overflow-y-auto [overflow-anchor:none] [scrollbar-gutter:stable] pb-8 pt-[var(--edge-fade-distance)] [container-name:thread-content] [container-type:inline-size]";

const THREAD_SCROLL_CONTENT_WRAPPER_CLASS_NAME =
  "mx-auto w-full max-w-[var(--thread-content-max-width)] px-2.5 md:px-panel";

const LocalConversationThreadScrollControllerContext =
  createContext<LocalConversationThreadScrollControllerContextValue | null>(null);

export function isThreadScrollNearBottom({
  scrollHeight,
  scrollTop,
  clientHeight,
}: ThreadScrollPositionSnapshot): boolean {
  return scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;
}

export function resolveThreadScrollModeForScrollEvent({
  currentMode,
  isNearBottom,
  nowMs,
  userScrollGraceUntilMs,
  programmaticScrollSettledUntilMs,
}: ThreadScrollModeResolutionInput): ThreadScrollMode {
  if (currentMode === "programmaticFind") {
    if (isNearBottom) return "stickToBottom";
    if (nowMs <= programmaticScrollSettledUntilMs) {
      return "programmaticFind";
    }
    return "user";
  }
  if (isNearBottom) return "stickToBottom";
  if (nowMs > programmaticScrollSettledUntilMs && nowMs <= userScrollGraceUntilMs) {
    return "user";
  }
  return currentMode;
}

function resolveScrollTargetPx(element: HTMLDivElement, topPx: number): number {
  return Math.max(0, Math.min(topPx, element.scrollHeight));
}

export function useLocalConversationThreadScrollController() {
  const context = useContext(LocalConversationThreadScrollControllerContext);
  if (context === null) {
    throw new Error(
      "useLocalConversationThreadScrollController must be used within a LocalConversationThreadScrollControllerProvider",
    );
  }
  return context;
}

function LocalConversationThreadScrollControllerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [isScrolledFromBottom, setIsScrolledFromBottom] = useState(false);
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const scrollModeRef = useRef<ThreadScrollMode>("stickToBottom");
  const userScrollGraceUntilRef = useRef(0);
  const programmaticScrollSettledUntilRef = useRef(0);
  const programmaticFindSettleTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    scrollElementRef.current = scrollElement;
  }, [scrollElement]);

  const setScrollMode = useCallback((mode: ThreadScrollMode) => {
    if (scrollModeRef.current === mode) return;
    scrollModeRef.current = mode;

    if (programmaticFindSettleTimeoutRef.current !== null) {
      window.clearTimeout(programmaticFindSettleTimeoutRef.current);
      programmaticFindSettleTimeoutRef.current = null;
    }

    if (mode !== "programmaticFind") {
      return;
    }

    programmaticFindSettleTimeoutRef.current = window.setTimeout(() => {
      programmaticFindSettleTimeoutRef.current = null;
      if (scrollModeRef.current !== "programmaticFind") {
        return;
      }

      const element = scrollElementRef.current;
      if (!element) {
        scrollModeRef.current = "user";
        return;
      }

      scrollModeRef.current = isThreadScrollNearBottom(element) ? "stickToBottom" : "user";
      setIsScrolledFromBottom(!isThreadScrollNearBottom(element));
    }, PROGRAMMATIC_SCROLL_SETTLE_WINDOW_MS);
  }, []);

  const getScrollMode = useCallback(() => scrollModeRef.current, []);

  const scrollToTopPx = useCallback((topPx: number, behavior: ScrollBehavior = "auto") => {
    const element = scrollElementRef.current;
    if (element === null) return;
    programmaticScrollSettledUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_SETTLE_WINDOW_MS;
    element.scrollTo({
      behavior,
      top: resolveScrollTargetPx(element, topPx),
    });
  }, []);

  const maybeStickToBottom = useCallback(() => {
    if (scrollModeRef.current !== "stickToBottom") return;
    const element = scrollElementRef.current;
    if (element === null) return;
    scrollToTopPx(element.scrollHeight, "auto");
  }, [scrollToTopPx]);

  const notifyContentLayout = useCallback(() => {
    maybeStickToBottom();
  }, [maybeStickToBottom]);

  const adjustForMeasuredTurnHeightDelta = useCallback(({
    heightDeltaPx,
    turnBottomPx,
    viewportTopPx,
  }: Omit<MeasuredTurnHeightDeltaInput, "currentScrollTopPx" | "scrollMode">) => {
    const element = scrollElementRef.current;
    if (element === null) return;
    const adjustedScrollTopPx = resolveAdjustedScrollTopForMeasuredTurnHeightDelta({
      currentScrollTopPx: element.scrollTop,
      heightDeltaPx,
      turnBottomPx,
      viewportTopPx,
      scrollMode: scrollModeRef.current,
    });
    if (adjustedScrollTopPx === null) return;
    scrollToTopPx(adjustedScrollTopPx, "auto");
  }, [scrollToTopPx]);

  const scrollToBottom = useCallback(() => {
    setScrollMode("stickToBottom");
    const element = scrollElementRef.current;
    if (element === null) return;
    scrollToTopPx(element.scrollHeight, "smooth");
  }, [scrollToTopPx, setScrollMode]);

  const jumpToBottom = useCallback(() => {
    setScrollMode("stickToBottom");
    const element = scrollElementRef.current;
    if (element === null) return;
    scrollToTopPx(element.scrollHeight, "auto");
  }, [scrollToTopPx, setScrollMode]);

  const suppressAutoStickToBottom = useCallback(() => {
    setScrollMode("user");
  }, [setScrollMode]);

  useEffect(() => {
    if (scrollElement === null) return;

    let mounted = true;
    const updateScrolledFromBottom = (isNearBottom: boolean) => {
      if (!mounted) return;
      setIsScrolledFromBottom(!isNearBottom);
    };

    const syncFromScrollPosition = () => {
      const isNearBottom = isThreadScrollNearBottom(scrollElement);
      const nextMode = resolveThreadScrollModeForScrollEvent({
        currentMode: scrollModeRef.current,
        isNearBottom,
        nowMs: performance.now(),
        userScrollGraceUntilMs: userScrollGraceUntilRef.current,
        programmaticScrollSettledUntilMs: programmaticScrollSettledUntilRef.current,
      });
      if (nextMode !== scrollModeRef.current) {
        scrollModeRef.current = nextMode;
      }
      updateScrolledFromBottom(isNearBottom);
    };

    updateScrolledFromBottom(isThreadScrollNearBottom(scrollElement));

    const frameId = window.requestAnimationFrame(() => {
      maybeStickToBottom();
    });

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) {
        userScrollGraceUntilRef.current = performance.now() + USER_SCROLL_GRACE_WINDOW_MS;
      }
      if (event.deltaY < -USER_SCROLL_WHEEL_DELTA_THRESHOLD_PX) {
        setScrollMode("user");
      }
    };

    const handlePointerDown = () => {
      userScrollGraceUntilRef.current = performance.now() + USER_SCROLL_GRACE_WINDOW_MS;
    };

    const handleScroll = () => {
      syncFromScrollPosition();
    };

    scrollElement.addEventListener("wheel", handleWheel, { passive: true });
    scrollElement.addEventListener("pointerdown", handlePointerDown, { passive: true });
    scrollElement.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      mounted = false;
      window.cancelAnimationFrame(frameId);
      scrollElement.removeEventListener("wheel", handleWheel);
      scrollElement.removeEventListener("pointerdown", handlePointerDown);
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [maybeStickToBottom, scrollElement, setScrollMode]);

  useEffect(
    () => () => {
      if (programmaticFindSettleTimeoutRef.current !== null) {
        window.clearTimeout(programmaticFindSettleTimeoutRef.current);
      }
    },
    [],
  );

  const controller = useMemo<LocalConversationThreadScrollControllerContextValue>(() => ({
    adjustForMeasuredTurnHeightDelta,
    getScrollMode,
    isScrolledFromBottom,
    jumpToBottom,
    maybeStickToBottom,
    notifyContentLayout,
    registerScrollElement: setScrollElement,
    scrollElement,
    scrollToBottom,
    scrollToTopPx,
    setScrollMode,
    suppressAutoStickToBottom,
  }), [
    adjustForMeasuredTurnHeightDelta,
    getScrollMode,
    isScrolledFromBottom,
    jumpToBottom,
    maybeStickToBottom,
    notifyContentLayout,
    scrollElement,
    scrollToBottom,
    scrollToTopPx,
    setScrollElement,
    setScrollMode,
    suppressAutoStickToBottom,
  ]);

  return (
    <LocalConversationThreadScrollControllerContext.Provider value={controller}>
      {children}
    </LocalConversationThreadScrollControllerContext.Provider>
  );
}

export function EnsureLocalConversationThreadScrollController({
  children,
}: {
  children: ReactNode;
}) {
  const context = useContext(LocalConversationThreadScrollControllerContext);
  if (context !== null) return <>{children}</>;
  return (
    <LocalConversationThreadScrollControllerProvider>
      {children}
    </LocalConversationThreadScrollControllerProvider>
  );
}

export const LocalConversationThreadScrollLayout = forwardRef<
  LocalConversationThreadScrollLayoutHandle,
  LocalConversationThreadScrollLayoutProps
>(function LocalConversationThreadScrollLayout({
  children,
  scrollViewClassName,
  contentWrapperClassName,
}, ref) {
  const controller = useLocalConversationThreadScrollController();

  useImperativeHandle(ref, () => ({
    scrollToBottom: controller.scrollToBottom,
  }), [controller.scrollToBottom]);

  return (
    <div className="relative h-full">
      <div
        ref={controller.registerScrollElement}
        data-local-conversation-thread-body="true"
        className={cn(
          THREAD_SCROLL_VIEWPORT_CLASS_NAME,
          scrollViewClassName,
        )}
      >
        <div
          className={cn(
            THREAD_SCROLL_CONTENT_WRAPPER_CLASS_NAME,
            contentWrapperClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
});
