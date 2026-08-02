import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { SidePanelSideChatIcon } from "@/components/shared/icons";
import type { ThreadStageActions } from "../thread-stage-types";

export const THREAD_SELECTED_TEXT_TARGET_SELECTOR = '[data-thread-selected-text-target="true"]';
const THREAD_SELECTED_TEXT_PORTAL_SELECTOR = '[data-mcp-app-portal-target="true"]';
const THREAD_SCROLL_FOOTER_SELECTOR = '[data-thread-scroll-footer="true"]';
const OVERLAY_WIDTH_PX = 156;
const OVERLAY_HEIGHT_PX = 32;
const OVERLAY_EDGE_GAP_PX = 8;
const OVERLAY_SELECTION_GAP_PX = 8;

export interface SelectedTextRectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SelectedTextOverlayLayoutInput {
  selectedText: string;
  rangeRects: readonly SelectedTextRectLike[];
  rangeBoundingRect: SelectedTextRectLike;
  portalRect: SelectedTextRectLike;
  scrollRect: SelectedTextRectLike;
  footerRect?: SelectedTextRectLike | null;
}

export interface SelectedTextOverlayLayout {
  leftPx: number;
  topPx: number;
}

interface SelectedTextOverlayState {
  text: string;
  layout: SelectedTextOverlayLayout;
  portalTarget: HTMLElement;
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function isUsableRect(rect: SelectedTextRectLike): boolean {
  return rect.width > 0 && rect.height > 0;
}

function rectIntersectsVerticalRange(rect: SelectedTextRectLike, top: number, bottom: number): boolean {
  return rect.bottom > top && rect.top < bottom;
}

function toRectLike(rect: DOMRect): SelectedTextRectLike {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function compareRectsByDocumentOrder(left: SelectedTextRectLike, right: SelectedTextRectLike): number {
  const topDelta = left.top - right.top;
  if (Math.abs(topDelta) > 1) return topDelta;
  return left.left - right.left;
}

function nodeToElement(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}

export function resolveCommonSelectedTextTarget(input: {
  rootElement: HTMLElement;
  anchorNode: Node | null;
  focusNode: Node | null;
  targetSelector?: string;
}): HTMLElement | null {
  const targetSelector = input.targetSelector ?? THREAD_SELECTED_TEXT_TARGET_SELECTOR;
  const anchorElement = nodeToElement(input.anchorNode);
  const focusElement = nodeToElement(input.focusNode);
  if (!anchorElement || !focusElement) return null;
  if (!input.rootElement.contains(anchorElement) || !input.rootElement.contains(focusElement)) return null;

  const anchorTarget = anchorElement.closest<HTMLElement>(targetSelector);
  const focusTarget = focusElement.closest<HTMLElement>(targetSelector);
  if (!anchorTarget || !focusTarget || anchorTarget !== focusTarget) return null;
  if (!input.rootElement.contains(anchorTarget)) return null;
  return anchorTarget;
}

export function resolveSelectedTextOverlayLayout(
  input: SelectedTextOverlayLayoutInput,
): SelectedTextOverlayLayout | null {
  if (input.selectedText.trim().length === 0) return null;
  if (!isUsableRect(input.portalRect) || !isUsableRect(input.scrollRect)) return null;

  const visibleTop = input.scrollRect.top + OVERLAY_EDGE_GAP_PX;
  const visibleBottom = Math.min(
    input.scrollRect.bottom,
    input.footerRect?.top ?? input.scrollRect.bottom,
  ) - OVERLAY_EDGE_GAP_PX;
  if (visibleBottom - visibleTop < OVERLAY_HEIGHT_PX) return null;

  const visibleRects = input.rangeRects
    .filter(isUsableRect)
    .filter((rect) => rectIntersectsVerticalRange(rect, visibleTop, visibleBottom))
    .sort(compareRectsByDocumentOrder);
  const anchorRect = visibleRects[0] ?? (
    rectIntersectsVerticalRange(input.rangeBoundingRect, visibleTop, visibleBottom)
      ? input.rangeBoundingRect
      : null
  );
  if (!anchorRect || !isUsableRect(anchorRect)) return null;

  const anchorCenterX = anchorRect.left + (anchorRect.width / 2);
  const minLeft = OVERLAY_EDGE_GAP_PX + (OVERLAY_WIDTH_PX / 2);
  const maxLeft = input.portalRect.width - OVERLAY_EDGE_GAP_PX - (OVERLAY_WIDTH_PX / 2);
  const leftPx = clampNumber(anchorCenterX - input.portalRect.left, minLeft, maxLeft);

  const aboveTop = anchorRect.top - OVERLAY_SELECTION_GAP_PX - OVERLAY_HEIGHT_PX;
  const belowTop = anchorRect.bottom + OVERLAY_SELECTION_GAP_PX;
  const preferredTop = aboveTop >= visibleTop ? aboveTop : belowTop;
  const clampedTop = clampNumber(preferredTop, visibleTop, visibleBottom - OVERLAY_HEIGHT_PX);

  return {
    leftPx,
    topPx: clampedTop - input.portalRect.top,
  };
}

function readSelectedTextOverlayState(scrollElement: HTMLElement): SelectedTextOverlayState | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;

  const selectedText = selection.toString().trim();
  if (selectedText.length === 0) return null;

  const portalTarget =
    scrollElement.querySelector<HTMLElement>(THREAD_SELECTED_TEXT_PORTAL_SELECTOR) ?? scrollElement;
  const selectedTarget = resolveCommonSelectedTextTarget({
    rootElement: portalTarget,
    anchorNode: selection.anchorNode,
    focusNode: selection.focusNode,
  });
  if (!selectedTarget) return null;

  const range = selection.getRangeAt(0);
  if (!selectedTarget.contains(range.startContainer) || !selectedTarget.contains(range.endContainer)) return null;

  const layout = resolveSelectedTextOverlayLayout({
    selectedText,
    rangeRects: Array.from(range.getClientRects(), toRectLike),
    rangeBoundingRect: toRectLike(range.getBoundingClientRect()),
    portalRect: toRectLike(portalTarget.getBoundingClientRect()),
    scrollRect: toRectLike(scrollElement.getBoundingClientRect()),
    footerRect: scrollElement.querySelector<HTMLElement>(THREAD_SCROLL_FOOTER_SELECTOR)?.getBoundingClientRect() ?? null,
  });
  if (!layout) return null;

  return {
    text: selectedText,
    layout,
    portalTarget,
  };
}

export function SelectedTextSideChatOverlayView({
  layout,
  containerRef,
  onAskInSideChat,
}: {
  layout: SelectedTextOverlayLayout;
  containerRef?: Ref<HTMLDivElement>;
  onAskInSideChat: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      ref={containerRef}
      data-selected-text-side-chat-overlay="true"
      className="absolute z-40"
      style={{
        left: layout.leftPx,
        top: layout.topPx,
        transform: "translateX(-50%)",
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label="Ask in side chat"
        className="no-drag flex h-8 items-center gap-1.5 rounded-xl bg-token-dropdown-background/90 px-2.5 text-xs font-medium text-token-foreground shadow-lg ring-[0.5px] ring-token-border backdrop-blur-md hover:bg-token-list-hover-background"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={onAskInSideChat}
      >
        <SidePanelSideChatIcon className="icon-xs shrink-0" />
        <span className="truncate">Ask in side chat</span>
      </button>
    </div>
  );
}

export function LocalConversationSelectedTextSideChatOverlay({
  enabled,
  scrollElement,
  onOpenSideChat,
}: {
  enabled: boolean;
  scrollElement: HTMLElement | null;
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
}) {
  const [overlayState, setOverlayState] = useState<SelectedTextOverlayState | null>(null);
  const overlayElementRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const onOpenSideChatRef = useRef(onOpenSideChat);

  useEffect(() => {
    onOpenSideChatRef.current = onOpenSideChat;
  }, [onOpenSideChat]);

  const clearOverlay = useCallback(() => {
    setOverlayState(null);
  }, []);

  useEffect(() => {
    if (!enabled || !scrollElement || !onOpenSideChat) {
      clearOverlay();
      return;
    }

    const cancelScheduledMeasure = () => {
      if (animationFrameRef.current === null) return;
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
    const measure = () => {
      animationFrameRef.current = null;
      setOverlayState(readSelectedTextOverlayState(scrollElement));
    };
    const scheduleMeasure = () => {
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = requestAnimationFrame(measure);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && overlayElementRef.current?.contains(target)) return;
      clearOverlay();
    };

    scheduleMeasure();
    document.addEventListener("selectionchange", scheduleMeasure);
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    scrollElement.addEventListener("scroll", scheduleMeasure, { passive: true });
    return () => {
      cancelScheduledMeasure();
      document.removeEventListener("selectionchange", scheduleMeasure);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", scheduleMeasure);
      scrollElement.removeEventListener("scroll", scheduleMeasure);
    };
  }, [
    clearOverlay,
    enabled,
    onOpenSideChat,
    scrollElement,
  ]);

  const handleAskInSideChat = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const text = overlayState?.text.trim() ?? "";
    if (!text) return;

    document.getSelection()?.removeAllRanges();
    clearOverlay();
    void onOpenSideChatRef.current?.({
      kind: "draft",
      draftPrompt: text,
    });
  }, [clearOverlay, overlayState?.text]);

  if (!enabled || !overlayState) return null;

  return createPortal(
    <SelectedTextSideChatOverlayView
      layout={overlayState.layout}
      containerRef={overlayElementRef}
      onAskInSideChat={handleAskInSideChat}
    />,
    overlayState.portalTarget,
  );
}
