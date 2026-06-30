import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  CodexSidePanelReviewIcon,
  ReviewCommitOrPushIcon,
  ReviewCreatePrIcon,
  ReviewFileDocumentIcon,
} from "@/components/shared/icons";
import { NodexTooltip } from "@/components/ui/tooltip";
import { logTelemetryEvent } from "@/lib/statsig-telemetry";
import { cn } from "../../../lib/utils";
import type {
  ThreadUserMessageNavigationItem,
  ThreadUserMessageNavigationOutput,
  ThreadUserMessageNavigationOutputType,
} from "../thread-stage-types";
import { getThreadUserMessageNavigationVisibleOutputs } from "../projection/thread-user-message-navigation-items";
import { useLocalConversationThreadScrollController } from "./local-conversation-thread-scroll-controller";
import {
  CodexConnectorFallbackIcon,
  CodexEditFilesIcon,
  CodexGlobeIcon,
  CodexPluginCubeIcon,
} from "./shared/tools/codex-tool-icons";

export type ThreadUserMessageNavigationRevealMode = "smooth" | "instant";

export const THREAD_USER_MESSAGE_NAVIGATION_TURN_CONTAINER_SELECTOR =
  "[data-turn-key], [data-content-search-turn-key]";

const THREAD_USER_MESSAGE_NAVIGATION_SEARCH_UNIT_SELECTOR =
  "[data-content-search-unit-key]";
const THREAD_USER_MESSAGE_NAVIGATION_LEFT_INSET_PX = 12;
const THREAD_USER_MESSAGE_NAVIGATION_ROW_WIDTH_PX = 36;
const THREAD_USER_MESSAGE_NAVIGATION_MIN_LEFT_SPACE_PX =
  THREAD_USER_MESSAGE_NAVIGATION_LEFT_INSET_PX + THREAD_USER_MESSAGE_NAVIGATION_ROW_WIDTH_PX;

export interface ThreadUserMessageNavigationRailProps {
  items: ThreadUserMessageNavigationItem[];
  onRevealItem?: (
    item: ThreadUserMessageNavigationItem,
    mode: ThreadUserMessageNavigationRevealMode,
  ) => HTMLElement | null | Promise<HTMLElement | null>;
}

function escapeAttributeSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function findUserMessageTarget(
  scrollElement: HTMLDivElement,
  item: ThreadUserMessageNavigationItem,
): HTMLElement | null {
  return scrollElement.querySelector<HTMLElement>(
    `[data-content-search-unit-key="${escapeAttributeSelectorValue(item.id)}"]`,
  );
}

export function resolveThreadUserMessageNavigationCurrentRangeIds(
  items: readonly ThreadUserMessageNavigationItem[],
  visibleIds: ReadonlySet<string>,
): Set<string> | null {
  const firstVisibleIndex = items.findIndex((item) => visibleIds.has(item.id));
  if (firstVisibleIndex < 0) return null;

  let lastVisibleIndex = firstVisibleIndex;
  for (let index = firstVisibleIndex + 1; index < items.length; index += 1) {
    const itemId = items[index]?.id;
    if (itemId && visibleIds.has(itemId)) {
      lastVisibleIndex = index;
    }
  }

  return new Set(
    items
      .slice(firstVisibleIndex, lastVisibleIndex + 1)
      .map((item) => item.id),
  );
}

export interface ThreadUserMessageNavigationObservationTarget {
  element: HTMLElement;
  itemId: string;
}

export function collectThreadUserMessageNavigationObservationTargets(
  root: ParentNode,
  itemIds: ReadonlySet<string>,
): ThreadUserMessageNavigationObservationTarget[] {
  const targets: ThreadUserMessageNavigationObservationTarget[] = [];
  const usedTurnContainers = new Set<HTMLElement>();
  const usedObservedElements = new Set<HTMLElement>();

  for (const searchUnit of root.querySelectorAll<HTMLElement>(
    THREAD_USER_MESSAGE_NAVIGATION_SEARCH_UNIT_SELECTOR,
  )) {
    const itemId = searchUnit.dataset.contentSearchUnitKey;
    if (!itemId || !itemIds.has(itemId)) continue;

    const turnContainer = searchUnit.closest<HTMLElement>(
      THREAD_USER_MESSAGE_NAVIGATION_TURN_CONTAINER_SELECTOR,
    );
    const observedElement =
      turnContainer && !usedTurnContainers.has(turnContainer)
        ? turnContainer
        : searchUnit;

    if (observedElement === turnContainer) {
      usedTurnContainers.add(turnContainer);
    }
    if (usedObservedElements.has(observedElement)) continue;

    usedObservedElements.add(observedElement);
    targets.push({ element: observedElement, itemId });
  }

  return targets;
}

export function threadUserMessageNavigationMutationsIncludeTurnContainer(
  records: readonly MutationRecord[],
): boolean {
  return records.some((record) =>
    [...record.addedNodes, ...record.removedNodes].some((node) =>
      node instanceof HTMLElement
      && (
        node.matches(THREAD_USER_MESSAGE_NAVIGATION_TURN_CONTAINER_SELECTOR)
        || node.querySelector(THREAD_USER_MESSAGE_NAVIGATION_TURN_CONTAINER_SELECTOR) !== null
      )
    ),
  );
}

export function ensureThreadUserMessageNavigationRowVisible(
  listElement: HTMLElement | null,
  activeItemId: string | null,
) {
  if (!listElement || !activeItemId) return;
  const row = listElement.querySelector<HTMLElement>(
    `[data-thread-user-message-navigation-item-id="${escapeAttributeSelectorValue(activeItemId)}"]`,
  );
  if (!row) return;

  if (row.offsetTop < listElement.scrollTop) {
    listElement.scrollTop = row.offsetTop;
    return;
  }

  if (row.offsetTop + row.offsetHeight > listElement.scrollTop + listElement.clientHeight) {
    listElement.scrollTop = row.offsetTop + row.offsetHeight - listElement.clientHeight + 1;
  }
}

export function hasEnoughThreadUserMessageNavigationLeftSpace({
  scrollElement,
  contentElement,
}: {
  scrollElement: HTMLElement;
  contentElement: HTMLElement;
}): boolean {
  const scrollRect = scrollElement.getBoundingClientRect();
  const contentRect = contentElement.getBoundingClientRect();
  const scale = scrollElement.offsetWidth > 0
    ? scrollRect.width / scrollElement.offsetWidth
    : 1;
  const normalizedLeftSpace = (contentRect.left - scrollRect.left) / (scale > 0 ? scale : 1);
  return normalizedLeftSpace >= THREAD_USER_MESSAGE_NAVIGATION_MIN_LEFT_SPACE_PX;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveOutputIcon(
  type: ThreadUserMessageNavigationOutputType,
): ComponentType<{ className?: string; "aria-hidden"?: boolean }> {
  if (type === "app") return CodexPluginCubeIcon;
  if (type === "website") return CodexGlobeIcon;
  if (type === "google-drive") return CodexConnectorFallbackIcon;
  if (type === "image") return CodexEditFilesIcon;
  if (type === "commit") return ReviewCommitOrPushIcon;
  if (type === "pull-request") return ReviewCreatePrIcon;
  if (type === "review") return CodexSidePanelReviewIcon;
  return ReviewFileDocumentIcon;
}

function NavigationOutputPill({ output }: { output: ThreadUserMessageNavigationOutput }) {
  const Icon = resolveOutputIcon(output.type);
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-token-foreground/5 px-1.5 py-0.5 text-xs leading-4 text-token-description-foreground">
      <Icon className="icon-3xs shrink-0" aria-hidden={true} />
      <span className="truncate">{output.label}</span>
    </span>
  );
}

function NavigationTooltipContent({ item }: { item: ThreadUserMessageNavigationItem }) {
  const outputs = getThreadUserMessageNavigationVisibleOutputs(item.outputs);

  return (
    <div className="w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl bg-token-dropdown-background/95 p-2 text-sm leading-5 text-token-foreground shadow-xl-spread ring-[0.5px] ring-token-border backdrop-blur-sm">
      <div className="truncate font-medium">{item.label}</div>
      {item.responsePreview ? (
        <div className="mt-1 line-clamp-3 text-token-description-foreground">
          {item.responsePreview}
        </div>
      ) : null}
      {outputs.length > 0 ? (
        <div className="mt-2 flex min-w-0 flex-wrap gap-1">
          {outputs.map((output) => (
            <NavigationOutputPill key={output.id} output={output} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ThreadUserMessageNavigationRail({
  items,
  onRevealItem,
}: ThreadUserMessageNavigationRailProps) {
  const {
    scrollElement,
    scrollElementIntoView,
    setScrollMode,
  } = useLocalConversationThreadScrollController();
  const reducedMotion = Boolean(useReducedMotion());
  const listRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const isScrubbingRef = useRef(false);
  const [currentItemIds, setCurrentItemIds] = useState<Set<string>>(() =>
    new Set(items.length > 0 ? [items[items.length - 1]?.id ?? ""] : []),
  );
  const [scrubTargetId, setScrubTargetId] = useState<string | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [layoutState, setLayoutState] = useState<{
    canRender: boolean;
    portalTarget: HTMLElement | null;
  }>({
    canRender: false,
    portalTarget: null,
  });

  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);

  const lastItemId = items[items.length - 1]?.id ?? null;
  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item] as const)),
    [items],
  );
  const itemIdsKey = useMemo(() => items.map((item) => item.id).join("\n"), [items]);

  useEffect(() => {
    setCurrentItemIds((current) => {
      const next = new Set([...current].filter((id) => itemIds.has(id)));
      if (next.size > 0) {
        return sameSet(current, next) ? current : next;
      }
      return new Set(lastItemId ? [lastItemId] : []);
    });
  }, [itemIds, itemIdsKey, lastItemId]);

  const currentPrimaryItemId = useMemo(
    () => items.find((item) => currentItemIds.has(item.id))?.id ?? lastItemId,
    [currentItemIds, items, lastItemId],
  );

  useEffect(() => {
    if (!scrollElement) {
      setLayoutState((current) =>
        current.canRender || current.portalTarget !== null
          ? { canRender: false, portalTarget: null }
          : current
      );
      return undefined;
    }

    const contentElement = scrollElement.querySelector<HTMLElement>(
      "[data-mcp-app-portal-target='true']",
    );
    if (!contentElement) {
      setLayoutState((current) =>
        current.canRender || current.portalTarget !== null
          ? { canRender: false, portalTarget: null }
          : current
      );
      return undefined;
    }

    let frameId: number | null = null;
    const syncLayoutState = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const nextState = {
          canRender: hasEnoughThreadUserMessageNavigationLeftSpace({
            scrollElement,
            contentElement,
          }),
          portalTarget: scrollElement.parentElement,
        };
        setLayoutState((current) =>
          current.canRender === nextState.canRender && current.portalTarget === nextState.portalTarget
            ? current
            : nextState
        );
        ensureThreadUserMessageNavigationRowVisible(listRef.current, currentPrimaryItemId);
      });
    };

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(syncLayoutState);
    resizeObserver?.observe(scrollElement);
    resizeObserver?.observe(contentElement);

    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(syncLayoutState);
    mutationObserver?.observe(scrollElement.firstElementChild ?? scrollElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    window.addEventListener("resize", syncLayoutState);
    syncLayoutState();

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", syncLayoutState);
    };
  }, [currentPrimaryItemId, scrollElement]);

  const highlightTarget = useCallback(
    (targetElement: HTMLElement) => {
      const pulseElement =
        targetElement.querySelector<HTMLElement>(
          "[data-user-message-bubble='true'],[data-composer-attachment-pill='true']",
        ) ?? targetElement;

      if (typeof pulseElement.animate !== "function") return;
      for (const animation of pulseElement.getAnimations?.() ?? []) {
        animation.cancel();
      }
      pulseElement.animate(
        [
          { backgroundColor: "color-mix(in srgb, var(--color-token-foreground) 14%, transparent)" },
          { backgroundColor: "color-mix(in srgb, var(--color-token-foreground) 5%, transparent)" },
        ],
        {
          duration: reducedMotion ? 0 : 1400,
          easing: "ease-out",
        },
      );
    },
    [reducedMotion],
  );

  const revealItem = useCallback(
    async (
      item: ThreadUserMessageNavigationItem,
      mode: ThreadUserMessageNavigationRevealMode,
    ) => {
      if (!scrollElement) return;

      const behavior: ScrollBehavior = mode === "instant" ? "auto" : "smooth";
      let targetElement = findUserMessageTarget(scrollElement, item);
      if (!targetElement) {
        targetElement = await onRevealItem?.(item, mode) ?? findUserMessageTarget(scrollElement, item);
      }
      if (!targetElement) return;

      setScrollMode("programmaticFind");
      scrollElementIntoView(targetElement, behavior, "start");
      await nextAnimationFrame();
      highlightTarget(targetElement);
    },
    [highlightTarget, onRevealItem, scrollElement, scrollElementIntoView, setScrollMode],
  );

  useEffect(() => {
    if (!scrollElement) return;
    if (items.length === 0) return;

    if (typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    const visibleIds = new Set<string>();
    const observedElements = new Set<HTMLElement>();
    const elementToItemId = new Map<HTMLElement, string>();

    const syncCurrentRange = () => {
      const rangeIds = resolveThreadUserMessageNavigationCurrentRangeIds(items, visibleIds);
      if (!rangeIds) return;
      setCurrentItemIds((current) => sameSet(current, rangeIds) ? current : rangeIds);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!(entry.target instanceof HTMLElement)) continue;
          const id = elementToItemId.get(entry.target);
          if (!id) continue;
          if (entry.isIntersecting) {
            visibleIds.add(id);
          } else {
            visibleIds.delete(id);
          }
        }
        syncCurrentRange();
      },
      {
        root: scrollElement,
        rootMargin: "-16px 0px 0px 0px",
      },
    );

    const registerTargets = () => {
      const nextTargets = collectThreadUserMessageNavigationObservationTargets(scrollElement, itemIds);
      const nextElements = new Set(nextTargets.map((target) => target.element));

      for (const element of [...observedElements]) {
        if (nextElements.has(element)) continue;
        const id = elementToItemId.get(element);
        if (id) visibleIds.delete(id);
        elementToItemId.delete(element);
        observedElements.delete(element);
        observer.unobserve(element);
      }

      for (const target of nextTargets) {
        const previousId = elementToItemId.get(target.element);
        if (previousId && previousId !== target.itemId) {
          visibleIds.delete(previousId);
        }
        elementToItemId.set(target.element, target.itemId);
        if (!observedElements.has(target.element)) {
          observedElements.add(target.element);
          observer.observe(target.element);
        }
      }

      syncCurrentRange();
    };

    registerTargets();
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver((records) => {
        if (threadUserMessageNavigationMutationsIncludeTurnContainer(records)) {
          registerTargets();
        }
      });
    mutationObserver?.observe(scrollElement, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver?.disconnect();
    };
  }, [itemIds, itemIdsKey, items, scrollElement]);

  useLayoutEffect(() => {
    if (isScrubbing) return;
    ensureThreadUserMessageNavigationRowVisible(listRef.current, currentPrimaryItemId);
  }, [currentPrimaryItemId, isScrubbing]);

  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      if (!isScrubbingRef.current) {
        ensureThreadUserMessageNavigationRowVisible(listElement, currentPrimaryItemId);
      }
    });
    observer.observe(listElement);
    return () => {
      observer.disconnect();
    };
  }, [currentPrimaryItemId]);

  const resolveRowFromPoint = useCallback((event: PointerEvent | ReactPointerEvent) => {
    const listElement = listRef.current;
    if (!listElement) return null;

    const rect = listElement.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = clamp(event.clientY, rect.top + 1, rect.bottom - 1);
    const target = document.elementFromPoint(x, y);
    return target?.closest<HTMLElement>("[data-thread-user-message-navigation-item-id]") ?? null;
  }, []);

  const clearPointerScrub = useCallback((event?: ReactPointerEvent<HTMLButtonElement>) => {
    if (event && pointerIdRef.current !== event.pointerId) return;
    if (event?.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    pointerIdRef.current = null;
    pointerStartRef.current = null;
    suppressNextClickRef.current = isScrubbingRef.current;
    isScrubbingRef.current = false;
    setIsScrubbing(false);
    setScrubTargetId(null);
  }, []);

  const handlePointerDown = useCallback((item: ThreadUserMessageNavigationItem, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    pointerIdRef.current = event.pointerId;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    suppressNextClickRef.current = false;
    isScrubbingRef.current = false;
    setScrubTargetId(item.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const start = pointerStartRef.current;
    if (!start) return;

    if (!isScrubbing) {
      const delta = Math.abs(event.clientY - start.y) + Math.abs(event.clientX - start.x);
      if (delta < 2) return;
      isScrubbingRef.current = true;
      setIsScrubbing(true);
    }

    const row = resolveRowFromPoint(event);
    const id = row?.getAttribute("data-thread-user-message-navigation-item-id") ?? null;
    if (!id || id === scrubTargetId) return;

    const item = itemsById.get(id);
    if (!item) return;
    setScrubTargetId(id);
    void revealItem(item, "instant");
  }, [isScrubbing, itemsById, revealItem, resolveRowFromPoint, scrubTargetId]);

  const handleClick = useCallback((item: ThreadUserMessageNavigationItem, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    logTelemetryEvent("thread_user_message_navigation", undefined, {
      ordinal: item.ordinal,
      itemCount: items.length,
      navigationMode: "smooth",
    });
    void revealItem(item, "smooth");
  }, [items.length, revealItem]);

  if (!layoutState.canRender || !layoutState.portalTarget || items.length === 0) return null;

  return createPortal(
    <motion.nav
      aria-label="User messages"
      className="absolute top-1/2 left-3 z-20 -translate-y-1/2 electron:left-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.15 }}
    >
      <div
        ref={listRef}
        data-thread-user-message-navigation-rail-list="true"
        data-scrubbing={scrubTargetId !== null ? "true" : undefined}
        className="vertical-scroll-fade-mask hide-scrollbar flex max-h-[min(70vh,40rem)] flex-col overflow-y-auto overscroll-contain [--edge-fade-distance:2.5rem]"
      >
        {items.map((item) => {
          const isCurrent = currentItemIds.has(item.id);
          const isScrubTarget = scrubTargetId === item.id;
          return (
            <NodexTooltip
              key={item.id}
              tooltipContent={<NavigationTooltipContent item={item} />}
              side="right"
              align="center"
              sideOffset={0}
              delayOpen
              interactive={false}
              open={isScrubTarget && scrubTargetId !== null ? true : undefined}
              surface="rich"
              tooltipClassName="!m-0 !rounded-xl !border-0 !bg-transparent !p-0 !shadow-none !ring-0 !backdrop-blur-none"
              tooltipBodyClassName="block w-full"
            >
              <button
                type="button"
                data-thread-user-message-navigation-item-id={item.id}
                data-scrub-target={isScrubTarget ? "true" : undefined}
                aria-label={`Jump to user message ${item.ordinal}`}
                aria-current={isCurrent ? "true" : undefined}
                className="group/navigation-row flex h-2.5 w-9 shrink-0 cursor-interaction items-center outline-none"
                onPointerDown={(event) => handlePointerDown(item, event)}
                onPointerMove={handlePointerMove}
                onPointerUp={clearPointerScrub}
                onPointerCancel={clearPointerScrub}
                onLostPointerCapture={clearPointerScrub}
                onClick={(event) => handleClick(item, event)}
              >
                <span className="flex h-0.5 w-[30px] items-center">
                  <span
                    className={cn(
                      "thread-user-message-navigation-marker block h-0.5 rounded-full bg-token-description-foreground opacity-40",
                      "group-focus-visible/navigation-row:bg-token-foreground group-focus-visible/navigation-row:opacity-100",
                      scrubTargetId === null && "group-hover/navigation-row:bg-token-foreground group-hover/navigation-row:opacity-100",
                      isCurrent && !isScrubTarget && "bg-token-foreground opacity-60",
                      isScrubTarget && "bg-token-foreground opacity-100",
                    )}
                  />
                </span>
              </button>
            </NodexTooltip>
          );
        })}
      </div>
    </motion.nav>,
    layoutState.portalTarget,
  );
}
