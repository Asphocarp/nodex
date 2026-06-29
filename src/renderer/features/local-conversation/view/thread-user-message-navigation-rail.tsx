import {
  useCallback,
  useEffect,
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

function resolveAbsoluteScrollTopPxForElement(input: {
  scrollElement: HTMLDivElement;
  targetElement: HTMLElement;
}): number {
  const scrollRect = input.scrollElement.getBoundingClientRect();
  const targetRect = input.targetElement.getBoundingClientRect();
  return targetRect.top - scrollRect.top + input.scrollElement.scrollTop;
}

function findUserMessageTarget(
  scrollElement: HTMLDivElement,
  item: ThreadUserMessageNavigationItem,
): HTMLElement | null {
  return scrollElement.querySelector<HTMLElement>(
    `[data-content-search-unit-key="${escapeAttributeSelectorValue(item.id)}"]`,
  );
}

function resolveCurrentRangeIds(
  items: readonly ThreadUserMessageNavigationItem[],
  visibleIds: ReadonlySet<string>,
): Set<string> | null {
  const firstVisibleIndex = items.findIndex((item) => visibleIds.has(item.id));
  if (firstVisibleIndex < 0) return null;

  let lastVisibleIndex = firstVisibleIndex;
  while (lastVisibleIndex + 1 < items.length && visibleIds.has(items[lastVisibleIndex + 1]?.id ?? "")) {
    lastVisibleIndex += 1;
  }

  return new Set(
    items
      .slice(firstVisibleIndex, lastVisibleIndex + 1)
      .map((item) => item.id),
  );
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
    scrollToTopPx,
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

  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);

  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item] as const)),
    [items],
  );
  const itemIdsKey = useMemo(() => items.map((item) => item.id).join("\n"), [items]);

  useEffect(() => {
    setCurrentItemIds(new Set(items.length > 0 ? [items[items.length - 1]?.id ?? ""] : []));
  }, [itemIdsKey, items]);

  const portalTarget = useMemo(() => {
    if (!scrollElement) return null;
    return scrollElement.closest<HTMLElement>("[data-thread-user-message-navigation-portal-target='true']")
      ?? scrollElement.parentElement
      ?? scrollElement;
  }, [scrollElement]);

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
      scrollToTopPx(
        resolveAbsoluteScrollTopPxForElement({
          scrollElement,
          targetElement,
        }),
        behavior,
      );
      await nextAnimationFrame();
      highlightTarget(targetElement);
    },
    [highlightTarget, onRevealItem, scrollElement, scrollToTopPx, setScrollMode],
  );

  useEffect(() => {
    if (!scrollElement) return;
    if (items.length === 0) return;

    if (typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    let observer: IntersectionObserver | null = null;
    const visibleIds = new Set<string>();
    const itemIds = new Set(items.map((item) => item.id));

    const syncCurrentRange = () => {
      const rangeIds = resolveCurrentRangeIds(items, visibleIds);
      if (!rangeIds) return;
      setCurrentItemIds((current) => sameSet(current, rangeIds) ? current : rangeIds);
    };

    const registerTargets = () => {
      observer?.disconnect();
      visibleIds.clear();
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const element = entry.target as HTMLElement;
            const id = element.getAttribute("data-content-search-unit-key");
            if (!id || !itemIds.has(id)) continue;
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
          threshold: [0, 0.01, 1],
        },
      );

      const targets = scrollElement.querySelectorAll<HTMLElement>("[data-content-search-unit-key]");
      for (const target of targets) {
        const id = target.getAttribute("data-content-search-unit-key");
        if (!id || !itemIds.has(id)) continue;
        observer.observe(target);
      }
    };

    registerTargets();
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(registerTargets);
    mutationObserver?.observe(scrollElement, { childList: true, subtree: true });

    return () => {
      observer?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [itemIdsKey, items, scrollElement]);

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

  if (!portalTarget || items.length === 0) return null;

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
        data-scrubbing={isScrubbing ? "true" : undefined}
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
              open={isScrubTarget && isScrubbing ? true : undefined}
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
                      isCurrent && "bg-token-foreground opacity-60",
                    )}
                  />
                </span>
              </button>
            </NodexTooltip>
          );
        })}
      </div>
    </motion.nav>,
    portalTarget,
  );
}
