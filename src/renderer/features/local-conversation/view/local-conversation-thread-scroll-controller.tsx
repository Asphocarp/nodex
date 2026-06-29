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
import { motion, useReducedMotion } from "motion/react";
import { CODEX_SHELL_PANEL_TRANSITION } from "../../../lib/codex-panel-motion";
import { cn } from "../../../lib/utils";
import {
  resolveAdjustedScrollDistanceFromBottomForMeasuredTurnHeightDelta,
  type MeasuredTurnHeightDeltaInput,
  type ThreadScrollMode,
} from "./local-conversation-turn-virtualization";

const USER_SCROLL_WHEEL_DELTA_THRESHOLD_PX = 12;
const USER_SCROLL_GRACE_WINDOW_MS = 750;
const PROGRAMMATIC_SCROLL_SETTLE_WINDOW_MS = 64;
const NEAR_BOTTOM_THRESHOLD_PX = 24;

export interface ThreadScrollPositionSnapshot {
  scrollDistanceFromBottomPx: number;
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
  getScrollDistanceFromBottomPx: () => number;
  maybeStickToBottom: () => void;
  scrollToBottom: () => void;
  jumpToBottom: () => void;
  scrollElementIntoView: (targetElement: HTMLElement, behavior?: ScrollBehavior, block?: ScrollLogicalPosition) => void;
  scrollToDistanceFromBottomPx: (distanceFromBottomPx: number, behavior?: ScrollBehavior) => void;
  adjustForMeasuredTurnHeightDelta: (input: Omit<MeasuredTurnHeightDeltaInput, "currentScrollDistanceFromBottomPx" | "scrollMode">) => void;
}

export interface LocalConversationThreadScrollLayoutHandle {
  scrollToBottom: () => void;
}

interface LocalConversationThreadScrollLayoutProps {
  children: ReactNode;
  contentX?: number;
  footer?: ReactNode;
  scrollViewClassName?: string;
  contentWrapperClassName?: string;
}

interface LocalConversationThreadScrollControllerContextValue
  extends LocalConversationThreadScrollControllerValue {
  registerScrollElement: (element: HTMLDivElement | null) => void;
}

const THREAD_SCROLL_VIEWPORT_CLASS_NAME =
  "thread-scroll-container relative h-full overflow-x-hidden overflow-y-auto [overflow-anchor:none] [scroll-padding-bottom:var(--thread-scroll-padding-bottom,0px)] electron:[scrollbar-gutter:stable_both-edges] pt-(--thread-content-top-inset) [container-name:thread-content] [container-type:inline-size] [&:has([data-thread-scroll-footer='true']:focus-within)]:[scroll-padding-bottom:0px] flex flex-col-reverse";

const THREAD_SCROLL_CONTENT_WRAPPER_CLASS_NAME =
  "mx-auto w-full max-w-(--thread-content-max-width) px-toolbar";

const LocalConversationThreadScrollControllerContext =
  createContext<LocalConversationThreadScrollControllerContextValue | null>(null);

export function isThreadScrollNearBottom({
  scrollDistanceFromBottomPx,
}: ThreadScrollPositionSnapshot): boolean {
  return scrollDistanceFromBottomPx <= NEAR_BOTTOM_THRESHOLD_PX;
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

export function getThreadScrollDistanceFromBottomPx(element: Pick<HTMLElement, "scrollTop">): number {
  return Math.max(0, -element.scrollTop);
}

function resolveScrollDistanceFromBottomPx(
  element: HTMLDivElement,
  distanceFromBottomPx: number,
): number {
  const maxDistanceFromBottomPx = Math.max(0, element.scrollHeight - element.clientHeight);
  return Math.max(0, Math.min(distanceFromBottomPx, maxDistanceFromBottomPx));
}

export function resolveNativeScrollTopForDistanceFromBottomPx(
  element: HTMLDivElement,
  distanceFromBottomPx: number,
): number {
  const nextDistanceFromBottomPx = resolveScrollDistanceFromBottomPx(element, distanceFromBottomPx);
  return nextDistanceFromBottomPx === 0 ? 0 : -nextDistanceFromBottomPx;
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

      const isNearBottom = isThreadScrollNearBottom({
        scrollDistanceFromBottomPx: getThreadScrollDistanceFromBottomPx(element),
      });
      scrollModeRef.current = isNearBottom ? "stickToBottom" : "user";
      setIsScrolledFromBottom(!isNearBottom);
    }, PROGRAMMATIC_SCROLL_SETTLE_WINDOW_MS);
  }, []);

  const getScrollMode = useCallback(() => scrollModeRef.current, []);

  const getScrollDistanceFromBottomPx = useCallback(() => {
    const element = scrollElementRef.current;
    if (element === null) return 0;
    return getThreadScrollDistanceFromBottomPx(element);
  }, []);

  const scrollToDistanceFromBottomPx = useCallback((
    distanceFromBottomPx: number,
    behavior: ScrollBehavior = "auto",
  ) => {
    const element = scrollElementRef.current;
    if (element === null) return;
    programmaticScrollSettledUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_SETTLE_WINDOW_MS;
    element.scrollTo({
      behavior,
      top: resolveNativeScrollTopForDistanceFromBottomPx(element, distanceFromBottomPx),
    });
  }, []);

  const scrollElementIntoView = useCallback((
    targetElement: HTMLElement,
    behavior: ScrollBehavior = "auto",
    block: ScrollLogicalPosition = "start",
  ) => {
    programmaticScrollSettledUntilRef.current = performance.now() + PROGRAMMATIC_SCROLL_SETTLE_WINDOW_MS;
    targetElement.scrollIntoView({ behavior, block, inline: "nearest" });
  }, []);

  const maybeStickToBottom = useCallback(() => {
    if (scrollModeRef.current !== "stickToBottom") return;
    const element = scrollElementRef.current;
    if (element === null) return;
    scrollToDistanceFromBottomPx(0, "auto");
  }, [scrollToDistanceFromBottomPx]);

  const notifyContentLayout = useCallback(() => {
    maybeStickToBottom();
  }, [maybeStickToBottom]);

  const adjustForMeasuredTurnHeightDelta = useCallback(({
    heightDeltaPx,
    turnTopDistanceFromBottomPx,
    viewportBottomDistanceFromBottomPx,
  }: Omit<MeasuredTurnHeightDeltaInput, "currentScrollDistanceFromBottomPx" | "scrollMode">) => {
    const element = scrollElementRef.current;
    if (element === null) return;
    const adjustedScrollDistanceFromBottomPx =
      resolveAdjustedScrollDistanceFromBottomForMeasuredTurnHeightDelta({
        currentScrollDistanceFromBottomPx: getThreadScrollDistanceFromBottomPx(element),
        heightDeltaPx,
        turnTopDistanceFromBottomPx,
        viewportBottomDistanceFromBottomPx,
        scrollMode: scrollModeRef.current,
      });
    if (adjustedScrollDistanceFromBottomPx === null) return;
    scrollToDistanceFromBottomPx(adjustedScrollDistanceFromBottomPx, "auto");
  }, [scrollToDistanceFromBottomPx]);

  const scrollToBottom = useCallback(() => {
    setScrollMode("stickToBottom");
    scrollToDistanceFromBottomPx(0, "smooth");
  }, [scrollToDistanceFromBottomPx, setScrollMode]);

  const jumpToBottom = useCallback(() => {
    setScrollMode("stickToBottom");
    scrollToDistanceFromBottomPx(0, "auto");
  }, [scrollToDistanceFromBottomPx, setScrollMode]);

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
      const isNearBottom = isThreadScrollNearBottom({
        scrollDistanceFromBottomPx: getThreadScrollDistanceFromBottomPx(scrollElement),
      });
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

    updateScrolledFromBottom(isThreadScrollNearBottom({
      scrollDistanceFromBottomPx: getThreadScrollDistanceFromBottomPx(scrollElement),
    }));

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
    getScrollDistanceFromBottomPx,
    getScrollMode,
    isScrolledFromBottom,
    jumpToBottom,
    maybeStickToBottom,
    notifyContentLayout,
    registerScrollElement: setScrollElement,
    scrollElementIntoView,
    scrollElement,
    scrollToBottom,
    scrollToDistanceFromBottomPx,
    setScrollMode,
    suppressAutoStickToBottom,
  }), [
    adjustForMeasuredTurnHeightDelta,
    getScrollDistanceFromBottomPx,
    getScrollMode,
    isScrolledFromBottom,
    jumpToBottom,
    maybeStickToBottom,
    notifyContentLayout,
    scrollElementIntoView,
    scrollElement,
    scrollToBottom,
    scrollToDistanceFromBottomPx,
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
  contentX,
  footer,
  scrollViewClassName,
  contentWrapperClassName,
}, ref) {
  const controller = useLocalConversationThreadScrollController();
  const reducedMotion = useReducedMotion();
  const footerRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({
    scrollToBottom: controller.scrollToBottom,
  }), [controller.scrollToBottom]);

  useEffect(() => {
    const scrollElement = controller.scrollElement;
    const footerElement = footerRef.current;
    if (!scrollElement || !footerElement) return undefined;

    const syncFooterPadding = () => {
      const footerHeight = footerElement.getBoundingClientRect().height;
      scrollElement.style.setProperty("--thread-scroll-padding-bottom", `${footerHeight + 16}px`);
    };

    syncFooterPadding();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncFooterPadding);
      return () => {
        window.removeEventListener("resize", syncFooterPadding);
      };
    }

    const resizeObserver = new ResizeObserver(syncFooterPadding);
    resizeObserver.observe(footerElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [controller.scrollElement, footer]);

  const motionStyle = contentX == null ? undefined : { x: contentX };

  return (
    <div
      data-thread-user-message-navigation-portal-target="true"
      className="relative h-full flex-1 [content-visibility:auto]"
    >
      <div
        ref={controller.registerScrollElement}
        data-local-conversation-thread-body="true"
        className={cn(
          THREAD_SCROLL_VIEWPORT_CLASS_NAME,
          scrollViewClassName,
        )}
      >
        <motion.div
          style={motionStyle}
          transition={reducedMotion ? { duration: 0 } : CODEX_SHELL_PANEL_TRANSITION}
          className="flex min-h-full shrink-0 flex-col justify-start"
        >
          <div
            data-mcp-app-portal-target="true"
            className={cn(
              THREAD_SCROLL_CONTENT_WRAPPER_CLASS_NAME,
              "relative flex shrink-0 flex-col pb-8",
              contentWrapperClassName,
            )}
          >
            {children}
          </div>
          {footer ? (
            <div
              ref={footerRef}
              data-thread-scroll-footer="true"
              className="sticky bottom-0 z-10 mt-auto w-full pb-2"
            >
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 flex h-full w-full justify-center pt-4">
                <div className="z-0 h-full w-full bg-gradient-to-t from-token-main-surface-primary via-token-main-surface-primary extension:from-token-bg-primary extension:via-token-bg-primary" />
              </div>
              <div className="relative z-10 flex flex-col">
                {footer}
              </div>
            </div>
          ) : null}
        </motion.div>
      </div>
    </div>
  );
});
