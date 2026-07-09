import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { dropTargetForElements, draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { NodexTooltip, NodexTooltipProvider } from "@/components/ui/tooltip";
import { APP_SHELL_FLOATING_UI_LAYER_CLASS } from "@/lib/app-shell-layers";
import type { PanelId } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  buildPanelGroupBodyDropData,
  buildPanelTabDragData,
  buildPanelTabRowDropData,
  isPanelTabDragData,
  type PanelTabDropIntent,
} from "./panel-tab-dnd";
import {
  APP_SHELL_TAB_GAP_PX,
  APP_SHELL_TAB_MAX_WIDTH_PX,
  APP_SHELL_TAB_MIN_WIDTH_PX,
  buildAppShellTabFlexSizing,
  buildAppShellTabListWidth,
} from "./app-shell-tab-sizing";

export type AppShellTabSplitSide = "left" | "right" | "up" | "down";

const APP_SHELL_SPLIT_ACTIONS: { side: AppShellTabSplitSide; label: string }[] = [
  { side: "left", label: "left" },
  { side: "right", label: "right" },
  { side: "up", label: "up" },
  { side: "down", label: "down" },
];
const APP_SHELL_TAB_ROW_WHEEL_LINE_HEIGHT_PX = 16;
const APP_SHELL_TAB_ROW_WHEEL_DELTA_LINE = 1;
const APP_SHELL_TAB_ROW_WHEEL_DELTA_PAGE = 2;
const APP_SHELL_PREVIEW_PIN_SUPPRESSED_SELECTOR = "[data-app-shell-preview-pin-suppressed='true']";
const APP_SHELL_TAB_COLLAPSED_MOTION = {
  "--app-shell-tab-separator-gutter": "0px",
  maxWidth: 0,
  minWidth: 0,
} as const;
const APP_SHELL_TAB_EXPANDED_MOTION = {
  "--app-shell-tab-separator-gutter": "4px",
  maxWidth: APP_SHELL_TAB_MAX_WIDTH_PX,
  minWidth: APP_SHELL_TAB_MIN_WIDTH_PX,
} as const;
const APP_SHELL_TAB_WIDTH_TRANSITION = {
  duration: 0.15,
  ease: [0.23, 1, 0.32, 1],
} as const;

export interface AppShellTabItem {
  id: string;
  domTabId?: string;
  title: string;
  contextLabel?: string;
  icon?: ComponentType<{ className?: string }>;
  closable?: boolean;
  retentionMode?: "layout";
  preview?: boolean;
  reorderable?: boolean;
  splittable?: boolean;
  isLabel?: boolean;
  disabled?: boolean;
  titleLabel?: string;
  tooltip?: ReactNode;
  contextMenuItems?: AppShellTabContextMenuItem[];
  renderPanel: (closeTab: () => void, context: AppShellTabPanelRenderContext) => ReactNode;
}

export interface AppShellTabPanelRenderContext {
  active: boolean;
}

function makeAppShellTabAccessibleLabel(tab: AppShellTabItem): string {
  if (tab.titleLabel) return tab.titleLabel;
  if (tab.contextLabel) return `${tab.contextLabel} · ${tab.title}`;
  return tab.title;
}

function makeAppShellTabDefaultTooltip(tab: AppShellTabItem): string {
  if (tab.contextLabel) return `${tab.contextLabel} · ${tab.title}`;
  return tab.title;
}

function isPreviewPinSuppressedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(APP_SHELL_PREVIEW_PIN_SUPPRESSED_SELECTOR));
}

export type AppShellTabContextMenuItem =
  | AppShellTabContextMenuActionItem
  | AppShellTabContextMenuSeparatorItem;

export interface AppShellTabContextMenuActionItem {
  id: string;
  type?: "item";
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface AppShellTabContextMenuSeparatorItem {
  id: string;
  type: "separator";
}

interface AppShellTabsProps {
  tabs: AppShellTabItem[];
  activeTabId: string;
  panelId?: string;
  controllerId?: string;
  onSelect: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  onDirectCloseTab?: (tabId: string) => void;
  onPinTab?: (tabId: string) => void;
  onMoveTab?: (tabId: string, targetPanelId: string) => void;
  onSplitTab?: (tabId: string, side: AppShellTabSplitSide) => void;
  panelTabDnd?: {
    sessionId: string;
    panelId: PanelId;
    leafId: string;
    activeDragId: string | null;
    previewIntent: PanelTabDropIntent | null;
  };
  beforeList?: ReactNode;
  afterTabsInline?: ReactNode;
  afterListSticky?: ReactNode;
  afterList?: ReactNode;
  bodyOverlay?: ReactNode;
  tabScrollEndPaddingPx?: number;
  headerEndInsetPx?: number;
  headerHeight?: "pane" | "toolbar";
  className?: string;
}

export function shouldShowAppShellTabSeparator({
  index,
  tabCount,
  activeIndex,
  draggingIndex,
  isActive,
  isDragging,
}: {
  index: number;
  tabCount: number;
  activeIndex: number;
  draggingIndex: number;
  isActive: boolean;
  isDragging: boolean;
}): boolean {
  if (index < 0 || index >= tabCount - 1) return false;
  if (isActive || isDragging) return false;
  if (index === activeIndex || index === activeIndex - 1) return false;
  if (index === draggingIndex || index === draggingIndex - 1) return false;

  return true;
}

export function AppShellTabs({
  tabs,
  activeTabId,
  panelId,
  controllerId = "cards",
  onSelect,
  onCloseTab,
  onDirectCloseTab,
  onPinTab,
  onMoveTab,
  onSplitTab,
  panelTabDnd,
  beforeList,
  afterTabsInline,
  afterListSticky,
  afterList,
  bodyOverlay,
  tabScrollEndPaddingPx = 0,
  headerEndInsetPx = 0,
  headerHeight = "pane",
  className,
}: AppShellTabsProps) {
  const tabRowRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [lockedTabWidthPx, setLockedTabWidthPx] = useState<number | null>(null);
  const [retainedTabCount, setRetainedTabCount] = useState(tabs.length);
  const { elementRef: afterTabsInlineRef, elementWidthPx: afterTabsInlineWidthPx } = useMeasuredElementWidth();
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const activePanelId = activeTab ? makeTabPanelId(controllerId, activeTab.id) : undefined;
  const activeIndex = activeTab ? tabs.findIndex((tab) => tab.id === activeTab.id) : -1;
  const draggingIndex = panelTabDnd?.activeDragId ? tabs.findIndex((tab) => tab.id === panelTabDnd.activeDragId) : -1;
  const tabRowPreview = panelTabDnd?.previewIntent?.kind === "tab-row"
    && panelTabDnd.previewIntent.panelId === panelTabDnd.panelId
    && panelTabDnd.previewIntent.leafId === panelTabDnd.leafId
    ? panelTabDnd.previewIntent
    : null;
  const dndSessionId = panelTabDnd?.sessionId;
  const dndPanelId = panelTabDnd?.panelId;
  const dndLeafId = panelTabDnd?.leafId;
  const retainedTabs = tabs.filter((tab) => tab.retentionMode === "layout");
  const activeTabIsRetained = activeTab?.retentionMode === "layout";
  const activeTabDomId = activeTab?.id ?? null;
  const previousActiveTabIdRef = useRef(activeTabDomId);
  if (tabs.length > retainedTabCount) {
    setRetainedTabCount(tabs.length);
  }
  const layoutTabCount = Math.max(tabs.length, retainedTabCount);
  const tabListWidth = buildAppShellTabListWidth({
    tabCount: layoutTabCount,
    trailingWidthPx: afterTabsInlineWidthPx,
    lockedWidthPx: lockedTabWidthPx,
  });
  const panelTabs = activeTab
    ? activeTabIsRetained
      ? retainedTabs
      : [activeTab, ...retainedTabs]
    : [];

  const exitTabCloseMode = useCallback(() => {
    setLockedTabWidthPx(null);
  }, []);

  const handleTabListMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    if (event.button !== 1 && !event.target.closest("[data-app-shell-tab-close-button]")) return;

    const tabElement = event.target.closest<HTMLElement>("[data-app-shell-tab-controller]");
    if (!tabElement) return;
    if (tabElement.offsetWidth <= 0) return;
    setLockedTabWidthPx(tabElement.offsetWidth);
  }, []);

  useEffect(() => {
    if (!dndSessionId || !dndPanelId || !dndLeafId) return undefined;
    const element = tabRowRef.current;
    if (!element) return undefined;

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isPanelTabDragData(source.data)
        && source.data.sessionId === dndSessionId,
      getIsSticky: () => true,
      getData: () => buildPanelTabRowDropData({
        sessionId: dndSessionId,
        panelId: dndPanelId,
        leafId: dndLeafId,
      }),
    });
  }, [dndLeafId, dndPanelId, dndSessionId]);

  useEffect(() => {
    const element = tabRowRef.current;
    if (!element) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (handleAppShellTabRowWheel(element, event)) {
        exitTabCloseMode();
      }
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", handleWheel);
    };
  }, [exitTabCloseMode]);

  useEffect(() => {
    if (!panelTabDnd?.activeDragId) return;
    exitTabCloseMode();
  }, [exitTabCloseMode, panelTabDnd?.activeDragId]);

  useLayoutEffect(() => {
    const previousActiveTabId = previousActiveTabIdRef.current;
    previousActiveTabIdRef.current = activeTabDomId;
    if (!previousActiveTabId || previousActiveTabId === activeTabDomId) return;

    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return;
    if (!bodyRef.current?.contains(activeElement)) return;
    if (!activeElement.closest("[hidden], [aria-hidden='true']")) return;

    activeElement.blur();
  }, [activeTabDomId]);

  useEffect(() => {
    if (!dndSessionId || !dndPanelId || !dndLeafId) return undefined;
    const element = bodyRef.current;
    if (!element) return undefined;

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isPanelTabDragData(source.data)
        && source.data.sessionId === dndSessionId,
      getIsSticky: () => true,
      getData: () => buildPanelGroupBodyDropData({
        sessionId: dndSessionId,
        panelId: dndPanelId,
        leafId: dndLeafId,
      }),
    });
  }, [dndLeafId, dndPanelId, dndSessionId]);

  const closeTab = (tabId: string) => {
    onCloseTab?.(tabId);
  };
  const closeTabFromDirectInteraction = (tabId: string) => {
    if (onDirectCloseTab) {
      onDirectCloseTab(tabId);
      return;
    }
    onCloseTab?.(tabId);
  };

  const pinTab = (tabId: string) => {
    onPinTab?.(tabId);
  };

  const pinPreviewTabFromPanelEvent = (event: SyntheticEvent<HTMLElement>) => {
    if (!activeTab?.preview) return;
    if (isPreviewPinSuppressedTarget(event.target)) return;
    pinTab(activeTab.id);
  };

  const renderPanel = (tab: AppShellTabItem, isActive: boolean, retained: boolean) => {
    const panelId = makeTabPanelId(controllerId, tab.id);
    const dataTabId = tab.domTabId ?? tab.id;

    return (
      <div
        key={`panel:${tab.id}`}
        role={isActive ? "tabpanel" : undefined}
        id={isActive ? panelId : undefined}
        aria-label={isActive ? makeAppShellTabAccessibleLabel(tab) : undefined}
        aria-hidden={isActive ? undefined : "true"}
        inert={isActive ? undefined : true}
        data-app-shell-tab-panel-controller={isActive ? (panelTabDnd?.panelId ?? controllerId) : undefined}
        data-tab-id={isActive ? dataTabId : undefined}
        data-app-shell-tabpanel-preview={isActive && tab.preview ? "true" : undefined}
        data-app-shell-tabpanel-retained={!isActive && retained ? tab.id : undefined}
        className={cn(
          "h-full min-h-0",
          isActive
            ? "relative"
            : "invisible pointer-events-none absolute inset-0 overflow-hidden",
        )}
        onPointerDownCapture={isActive ? pinPreviewTabFromPanelEvent : undefined}
        onKeyDownCapture={isActive ? pinPreviewTabFromPanelEvent : undefined}
      >
        {isActive ? bodyOverlay : null}
        {tab.renderPanel(() => closeTab(tab.id), { active: isActive })}
      </div>
    );
  };

  const tabList = (
    <div
      role="tablist"
      className="relative z-0 flex shrink-0"
      onMouseDownCapture={handleTabListMouseDownCapture}
      style={{ gap: APP_SHELL_TAB_GAP_PX, width: tabListWidth }}
    >
      <AnimatePresence initial={false} onExitComplete={() => setRetainedTabCount(tabs.length)}>
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTab?.id;
          return (
            <AppShellTab
              key={tab.id}
              tab={tab}
              controllerId={controllerId}
              panelTabDnd={panelTabDnd}
              isActive={isActive}
              isDragging={panelTabDnd?.activeDragId === tab.id}
              lockedWidthPx={lockedTabWidthPx}
              panelId={activePanelId}
              separatorIndex={index}
              activeTabIndex={activeIndex}
              draggingIndex={draggingIndex}
              tabCount={tabs.length}
              tabs={tabs}
              onSelect={onSelect}
              onClose={tab.closable ? closeTab : undefined}
              onDirectClose={tab.closable ? closeTabFromDirectInteraction : undefined}
              onCloseModeExit={exitTabCloseMode}
              onPin={tab.preview ? pinTab : undefined}
              onMove={onMoveTab}
              onSplit={onSplitTab}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );

  return (
    <NodexTooltipProvider>
      <div
        data-app-shell-panel-id={panelId}
        className={cn("flex h-full min-h-0 flex-col bg-token-main-surface-primary", className)}
      >
        <div
          className={cn(
            "isolate flex min-w-0 shrink-0 select-none items-center bg-token-main-surface-primary px-2 [contain:layout_paint]",
            headerHeight === "toolbar" ? "h-toolbar" : "h-toolbar-pane",
          )}
        >
          {beforeList ? <div role="presentation" className="no-drag my-auto flex shrink-0 items-center">{beforeList}</div> : null}
          <div
            ref={tabRowRef}
            data-panel-tab-row={panelTabDnd ? `${panelTabDnd.panelId}:${panelTabDnd.leafId}` : undefined}
            data-app-shell-tab-close-mode={lockedTabWidthPx !== null ? "true" : undefined}
            className="hide-scrollbar relative isolate flex h-full min-w-0 flex-1 scroll-px-1 items-center overflow-x-auto overflow-y-hidden [contain:layout_paint]"
            style={{
              scrollPaddingInlineEnd: tabScrollEndPaddingPx,
            }}
            onPointerLeave={exitTabCloseMode}
          >
            <div
              aria-hidden="true"
              className="sticky start-0 z-10 h-full w-0 opacity-0 transition-opacity duration-100 after:absolute after:start-0 after:top-0 after:bottom-0 after:w-10 after:bg-linear-to-l after:from-transparent after:to-token-main-surface-primary after:content-[''] after:pointer-events-none"
            />
            <span aria-hidden="true" />
            {tabList}
            {afterTabsInline ? (
              <div ref={afterTabsInlineRef} className="no-drag sticky right-0 z-10 flex h-full shrink-0 items-center bg-token-main-surface-primary">{afterTabsInline}</div>
            ) : null}
            {tabRowPreview ? (
              <div
                aria-hidden="true"
                data-panel-tab-insertion-marker={`${tabRowPreview.panelId}:${tabRowPreview.leafId}:${tabRowPreview.targetIndex}`}
                className="pointer-events-none absolute top-1/2 z-30 h-4 w-0 -translate-y-1/2 border-l-2 border-token-foreground/80"
                style={{ left: tabRowPreview.markerLeft }}
              />
            ) : null}
            <span aria-hidden="true" />
            <div
              aria-hidden="true"
              className="sticky end-0 z-10 h-full w-0 opacity-0 transition-opacity duration-100 after:absolute after:end-0 after:inset-y-0 after:w-10 after:bg-linear-to-r after:from-transparent after:to-token-main-surface-primary after:content-[''] after:pointer-events-none"
              style={{ right: tabScrollEndPaddingPx }}
            />
          </div>
          {afterListSticky ? (
            <div role="presentation" className="no-drag my-auto flex shrink-0 items-center">{afterListSticky}</div>
          ) : null}
          {afterList ? (
            <div role="presentation" className="no-drag my-auto flex shrink-0 items-center">{afterList}</div>
          ) : null}
          {headerEndInsetPx > 0 ? (
            <div
              aria-hidden="true"
              className="no-drag pointer-events-none h-full shrink-0"
              style={{ width: headerEndInsetPx }}
            />
          ) : null}
        </div>

        {activeTab ? (
          <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-hidden">
            {panelTabs.map((tab) => renderPanel(tab, tab.id === activeTab.id, tab.retentionMode === "layout"))}
          </div>
        ) : null}
      </div>
    </NodexTooltipProvider>
  );
}

function useMeasuredElementWidth(): {
  elementRef: (element: HTMLDivElement | null) => void;
  elementWidthPx: number;
} {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [elementWidthPx, setElementWidthPx] = useState(0);

  const elementRef = useCallback((nextElement: HTMLDivElement | null) => {
    setElement(nextElement);
  }, []);

  useLayoutEffect(() => {
    if (!element) {
      setElementWidthPx(0);
      return undefined;
    }

    const measure = () => {
      const nextWidthPx = Math.ceil(element.getBoundingClientRect().width);
      setElementWidthPx((currentWidthPx) => currentWidthPx === nextWidthPx ? currentWidthPx : nextWidthPx);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return undefined;

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
    };
  }, [element]);

  return {
    elementRef,
    elementWidthPx,
  };
}

function handleAppShellTabRowWheel(element: HTMLElement, event: WheelEvent): boolean {
  if (event.ctrlKey || event.metaKey) return false;

  const maxScrollLeft = element.scrollWidth - element.clientWidth;
  if (maxScrollLeft <= 0) return false;

  const deltaPx = normalizeAppShellTabRowWheelDeltaPx(event, element.clientWidth);
  if (deltaPx === 0) return false;

  const currentScrollLeft = element.scrollLeft;
  const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, currentScrollLeft + deltaPx));
  if (nextScrollLeft === currentScrollLeft) return false;

  event.stopPropagation();
  if (event.cancelable) event.preventDefault();
  element.scrollLeft = nextScrollLeft;
  return true;
}

function normalizeAppShellTabRowWheelDeltaPx(
  event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">,
  pageWidthPx: number,
): number {
  const rawDelta = getDominantAppShellTabRowWheelDelta(event);
  if (rawDelta === 0) return 0;

  if (event.deltaMode === APP_SHELL_TAB_ROW_WHEEL_DELTA_LINE) {
    return rawDelta * APP_SHELL_TAB_ROW_WHEEL_LINE_HEIGHT_PX;
  }
  if (event.deltaMode === APP_SHELL_TAB_ROW_WHEEL_DELTA_PAGE && pageWidthPx > 0) {
    return rawDelta * pageWidthPx;
  }
  return rawDelta;
}

function getDominantAppShellTabRowWheelDelta({
  deltaX,
  deltaY,
}: Pick<WheelEvent, "deltaX" | "deltaY">): number {
  if (deltaX === 0) return deltaY;
  if (deltaY === 0) return deltaX;

  return Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
}

function blurActiveElementWithin(element: HTMLElement): void {
  const activeElement = element.ownerDocument.activeElement;
  if (!(activeElement instanceof HTMLElement)) return;
  if (!element.contains(activeElement)) return;

  activeElement.blur();
}

function AppShellTab({
  tab,
  controllerId,
  panelTabDnd,
  isActive,
  isDragging,
  lockedWidthPx,
  panelId,
  separatorIndex,
  activeTabIndex,
  draggingIndex,
  tabCount,
  tabs,
  onSelect,
  onClose,
  onDirectClose,
  onCloseModeExit,
  onPin,
  onMove,
  onSplit,
}: {
  tab: AppShellTabItem;
  controllerId: string;
  panelTabDnd?: AppShellTabsProps["panelTabDnd"];
  isActive: boolean;
  isDragging: boolean;
  lockedWidthPx: number | null;
  panelId?: string;
  separatorIndex: number;
  activeTabIndex: number;
  draggingIndex: number;
  tabCount: number;
  tabs: AppShellTabItem[];
  onSelect: (tabId: string) => void;
  onClose?: (tabId: string) => void;
  onDirectClose?: (tabId: string) => void;
  onCloseModeExit: () => void;
  onPin?: (tabId: string) => void;
  onMove?: (tabId: string, targetPanelId: string) => void;
  onSplit?: (tabId: string, side: AppShellTabSplitSide) => void;
}) {
  const tabRef = useRef<HTMLDivElement | null>(null);
  const Icon = tab.icon;
  const dataTabId = tab.domTabId ?? tab.id;
  const tabId = makeTabId(controllerId, tab.id);
  const accessibleLabel = makeAppShellTabAccessibleLabel(tab);
  const tooltipContent = tab.tooltip ?? makeAppShellTabDefaultTooltip(tab);
  const titleRef = useRef<HTMLSpanElement | null>(null);
  const titleOverflows = useAppShellTabTitleOverflow(titleRef, tab.title);
  const title = (
    <span
      ref={titleRef}
      data-app-shell-tab-title={tab.id}
      className={cn("inline-block min-w-0 whitespace-nowrap", tab.preview && "italic")}
    >
      {tab.title}
    </span>
  );
  const label = (
    <span className="flex min-w-0 items-center gap-1">
      {tab.contextLabel ? (
        <>
          <span
            data-app-shell-tab-context-label={tab.id}
            className="max-w-20 shrink truncate text-xs text-token-description-foreground"
          >
            {tab.contextLabel}
          </span>
          <span aria-hidden="true" className="shrink-0 text-token-description-foreground">
            ·
          </span>
        </>
      ) : null}
      {title}
    </span>
  );

  const closeCurrentTab = () => {
    onClose?.(tab.id);
  };
  const closeCurrentTabFromDirectInteraction = () => {
    if (onDirectClose) {
      onDirectClose(tab.id);
      return;
    }
    closeCurrentTab();
  };
  const closeOtherTabs = () => {
    for (const candidate of tabs) {
      if (candidate.id === tab.id) continue;
      if (candidate.closable !== true) continue;
      onClose?.(candidate.id);
    }
  };
  const closeTabsToRight = () => {
    const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
    if (tabIndex === -1) return;
    for (const candidate of tabs.slice(tabIndex + 1)) {
      if (candidate.closable !== true) continue;
      onClose?.(candidate.id);
    }
  };
  const targetPanelId = controllerId.includes("bottom") ? "right" : "bottom";
  const moveCurrentTab = () => {
    onMove?.(tab.id, targetPanelId);
  };
  const pinCurrentTab = () => {
    onPin?.(tab.id);
  };
  const splitCurrentTab = (side: AppShellTabSplitSide) => {
    onSplit?.(tab.id, side);
  };
  const showSeparator = shouldShowAppShellTabSeparator({
    index: separatorIndex,
    tabCount,
    activeIndex: activeTabIndex,
    draggingIndex,
    isActive,
    isDragging,
  });
  const dndSessionId = panelTabDnd?.sessionId;
  const dndPanelId = panelTabDnd?.panelId;
  const dndLeafId = panelTabDnd?.leafId;
  const isDraggable = Boolean(panelTabDnd && tab.isLabel !== true && tab.reorderable !== false);
  const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
  const hasOtherClosableTabs = tabs.some((candidate) => candidate.id !== tab.id && candidate.closable === true);
  const hasClosableTabsToRight = tabIndex !== -1 && tabs.slice(tabIndex + 1).some((candidate) => candidate.closable === true);
  const flexSizing = buildAppShellTabFlexSizing(lockedWidthPx);

  useEffect(() => {
    if (!dndSessionId || !dndPanelId || !dndLeafId) return undefined;
    if (tab.isLabel === true || tab.reorderable === false) return undefined;
    const element = tabRef.current;
    if (!element) return undefined;

    return draggable({
      element,
      canDrag: ({ input }) => {
        const target = element.ownerDocument.elementFromPoint(input.clientX, input.clientY);
        if (target?.closest("[data-app-shell-tab-no-drag='true']")) return false;
        return true;
      },
      getInitialData: () => buildPanelTabDragData({
        sessionId: dndSessionId,
        panelId: dndPanelId,
        leafId: dndLeafId,
        tabId: tab.id,
      }),
      onDragStart: () => {
        onCloseModeExit();
        blurActiveElementWithin(element);
      },
    });
  }, [dndLeafId, dndPanelId, dndSessionId, onCloseModeExit, tab.id, tab.isLabel, tab.reorderable]);

  const chrome = (
    <motion.div
      ref={tabRef}
      data-app-shell-tab-controller={controllerId}
      data-tab-id={dataTabId}
      data-panel-tab-id={tab.id}
      data-app-shell-tab-preview={tab.preview ? "true" : undefined}
      data-app-shell-tab-locked-width={lockedWidthPx ?? undefined}
      className={cn(
        "no-drag relative my-auto flex shrink-0 items-center gap-0.5 overflow-hidden pe-(--app-shell-tab-separator-gutter) contain-content",
        isDraggable && "cursor-grab",
        isDragging && "z-10 cursor-grabbing opacity-45",
      )}
      initial={APP_SHELL_TAB_COLLAPSED_MOTION}
      animate={APP_SHELL_TAB_EXPANDED_MOTION}
      exit={APP_SHELL_TAB_COLLAPSED_MOTION}
      transition={APP_SHELL_TAB_WIDTH_TRANSITION}
      style={{ flexBasis: flexSizing.flexBasis, flexGrow: flexSizing.flexGrow }}
    >
      <div
        data-tab-id={dataTabId}
        className="group group/tab relative flex h-7 w-full max-w-39 shrink-0 items-center overflow-hidden rounded-md bg-token-main-surface-primary px-2 py-1"
        role="button"
        tabIndex={tab.disabled ? -1 : 0}
        aria-disabled={tab.disabled ? "true" : "false"}
        style={{
          "--app-shell-tab-background": "color-mix(in srgb, var(--color-token-foreground) 5%, var(--color-token-main-surface-primary))",
        } as CSSProperties}
        onMouseDown={(event) => {
          if (event.button !== 1 || !onClose) return;
          event.preventDefault();
          event.stopPropagation();
          closeCurrentTabFromDirectInteraction();
        }}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-0 rounded-md group-hover/tab:bg-[var(--app-shell-tab-background)]",
            (isActive || isDragging) && "bg-[var(--app-shell-tab-background)]",
          )}
        />
        <button
          type="button"
          id={tabId}
          role="tab"
          aria-selected={isActive}
          aria-controls={isActive ? panelId : undefined}
          aria-label={accessibleLabel}
          disabled={tab.disabled}
          className={cn(
            "no-drag relative z-10 flex min-w-0 flex-1 items-center gap-2 text-sm",
            isActive ? "text-token-text-primary" : "text-token-text-secondary",
          )}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            if (tab.disabled) return;
            onSelect(tab.id);
          }}
          onClick={(event) => {
            if (event.detail !== 0) return;
            if (tab.disabled) return;
            onSelect(tab.id);
          }}
          onDoubleClick={(event) => {
            if (event.button !== 0) return;
            if (tab.disabled) return;
            if (tab.preview !== true || !onPin) return;
            event.preventDefault();
            event.stopPropagation();
            pinCurrentTab();
          }}
        >
          {Icon ? (
            <span aria-hidden="true" className="icon-xs relative flex shrink-0 items-center justify-center overflow-visible">
              <Icon className="icon-xs shrink-0" />
            </span>
          ) : null}
          <NodexTooltip
            tooltipContent={tooltipContent}
            disabled={isDragging}
            delayOpen
            side="bottom"
            align="start"
          >
            {label}
          </NodexTooltip>
        </button>
        {onClose ? (
          <button
            type="button"
            data-app-shell-tab-close-button="true"
            data-app-shell-tab-no-drag="true"
            aria-label={`Close ${accessibleLabel} tab`}
            className="no-drag invisible absolute inset-y-0 end-1 z-30 flex cursor-interaction items-center pe-1 text-token-text-tertiary group-has-[:focus-visible]:visible group-hover/tab:visible hover:text-token-text-primary after:absolute after:-inset-1 after:content-[''] before:pointer-events-none before:absolute before:inset-y-0 before:end-1 before:w-[26px] before:bg-linear-to-r before:from-transparent before:to-30% before:content-[''] before:to-token-main-surface-primary group-hover/tab:before:to-[var(--app-shell-tab-background)]"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeCurrentTabFromDirectInteraction();
            }}
          >
            <CodexTabCloseIcon className="icon-xs relative" />
          </button>
        ) : null}
        {titleOverflows ? (
          <div
            aria-hidden="true"
            data-app-shell-tab-title-fade={tab.id}
            className={cn(
              "pointer-events-none absolute inset-y-0 end-0 z-20 w-2 bg-linear-to-r from-transparent to-100%",
              isActive
                ? "to-[var(--app-shell-tab-background)]"
                : "to-token-main-surface-primary group-hover/tab:to-[var(--app-shell-tab-background)]",
            )}
          />
        ) : null}
      </div>
      <div
        aria-hidden="true"
        data-app-shell-tab-separator={tab.id}
        data-app-shell-tab-separator-index={separatorIndex}
        className={cn(
          "absolute end-0 h-3 w-px shrink-0 bg-token-border transition-opacity duration-200",
          showSeparator ? "opacity-100" : "opacity-0",
        )}
      />
    </motion.div>
  );

  if (!onClose) {
    return chrome;
  }

  const contextMenuItems = buildAppShellTabContextMenuItems({
    customItems: tab.contextMenuItems,
    canCloseOtherTabs: hasOtherClosableTabs,
    canCloseTabsToRight: hasClosableTabsToRight,
    canPinTab: tab.preview === true && Boolean(onPin),
    canMoveTab: Boolean(onMove) && tab.preview !== true,
    canSplitTab: Boolean(onSplit) && tab.splittable === true,
    targetPanelId,
    onClose: closeCurrentTab,
    onCloseOtherTabs: closeOtherTabs,
    onCloseTabsToRight: closeTabsToRight,
    onPin: pinCurrentTab,
    onMove: moveCurrentTab,
    onSplit: splitCurrentTab,
  });

  return (
    <ContextMenuPrimitive.Root onOpenChange={(open) => {
      if (!open) return;
      onCloseModeExit();
    }}>
      <ContextMenuPrimitive.Trigger asChild>{chrome}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className={cn(
            "no-drag bg-token-dropdown-background/90 text-token-foreground ring-token-border m-px min-w-36 select-none overflow-hidden rounded-xl px-1 py-1 shadow-xl-spread ring-[0.5px] backdrop-blur-sm",
            APP_SHELL_FLOATING_UI_LAYER_CLASS,
          )}
        >
          {contextMenuItems.map((item) => (
            item.type === "separator" ? (
              <ContextMenuDivider key={item.id} />
            ) : (
              <ContextMenuPrimitive.Item
                key={item.id}
                disabled={item.disabled}
                className={cn(
                  "cursor-interaction rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm outline-hidden hover:bg-token-list-hover-background focus:bg-token-list-hover-background",
                  item.disabled && "cursor-default opacity-50",
                )}
                onSelect={item.disabled ? undefined : item.onSelect}
              >
                {item.label}
              </ContextMenuPrimitive.Item>
            )
          ))}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

function buildAppShellTabContextMenuItems({
  customItems,
  canCloseOtherTabs,
  canCloseTabsToRight,
  canPinTab,
  canMoveTab,
  canSplitTab,
  targetPanelId,
  onClose,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onPin,
  onMove,
  onSplit,
}: {
  customItems: AppShellTabContextMenuItem[] | undefined;
  canCloseOtherTabs: boolean;
  canCloseTabsToRight: boolean;
  canPinTab: boolean;
  canMoveTab: boolean;
  canSplitTab: boolean;
  targetPanelId: string;
  onClose: () => void;
  onCloseOtherTabs: () => void;
  onCloseTabsToRight: () => void;
  onPin: () => void;
  onMove: () => void;
  onSplit: (side: AppShellTabSplitSide) => void;
}): AppShellTabContextMenuItem[] {
  const items: AppShellTabContextMenuItem[] = [...(customItems ?? [])];
  if (items.length > 0) {
    items.push({ id: "close-tab-separator", type: "separator" });
  }
  items.push(
    {
      id: "close-tab",
      label: "Close",
      onSelect: onClose,
    },
    {
      id: "close-other-tabs",
      label: "Close other tabs",
      disabled: !canCloseOtherTabs,
      onSelect: onCloseOtherTabs,
    },
    {
      id: "close-tabs-to-the-right",
      label: "Close tabs to the right",
      disabled: !canCloseTabsToRight,
      onSelect: onCloseTabsToRight,
    },
  );
  if (canPinTab) {
    items.push({
      id: "pin-tab",
      label: "Pin tab",
      onSelect: onPin,
    });
  }
  if (canMoveTab) {
    items.push({
      id: "move-tab",
      label: `Move to ${targetPanelId === "bottom" ? "bottom panel" : "right panel"}`,
      onSelect: onMove,
    });
  }
  if (canSplitTab) {
    items.push({ id: "split-tab-separator", type: "separator" });
    for (const action of APP_SHELL_SPLIT_ACTIONS) {
      items.push({
        id: `split-tab-${action.side}`,
        label: `Split tab ${action.label}`,
        onSelect: () => onSplit(action.side),
      });
    }
  }
  return items;
}

function ContextMenuDivider() {
  return (
    <div className="w-full px-[var(--padding-row-x)] py-1">
      <div className="h-px w-full bg-token-menu-border" />
    </div>
  );
}

function useAppShellTabTitleOverflow(
  titleRef: RefObject<HTMLElement | null>,
  title: string,
): boolean {
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const titleElement = titleRef.current;
    if (!titleElement) {
      setOverflows(false);
      return undefined;
    }

    const measure = () => {
      const nextOverflows = titleElement.scrollWidth - titleElement.clientWidth > 1;
      setOverflows((current) => (current === nextOverflows ? current : nextOverflows));
    };

    measure();

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(measure);
    resizeObserver?.observe(titleElement);
    window.addEventListener("resize", measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [title, titleRef]);

  return overflows;
}

function makeTabId(controllerId: string, tabId: string): string {
  return `app-shell-tab-${controllerId}-${encodeTabId(tabId)}`;
}

function makeTabPanelId(controllerId: string, tabId: string): string {
  return `app-shell-tabpanel-${controllerId}-${encodeTabId(tabId)}`;
}

function encodeTabId(tabId: string): string {
  return tabId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function CodexTabCloseIcon({ className }: { className?: string }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.7997 2.48486C15.4019 2.48486 19.1335 6.21565 19.1337 10.8179C19.1337 15.4202 15.4021 19.1519 10.7997 19.1519C6.19746 19.1517 2.46667 15.4201 2.46667 10.8179C2.46685 6.21576 6.19757 2.48504 10.7997 2.48486ZM9.00811 7.5181C8.62612 7.13627 8.00684 7.13624 7.62534 7.5181C7.24363 7.89971 7.24366 8.51913 7.62534 8.90088L9.54183 10.8179L7.62534 12.7343C7.24375 13.116 7.24365 13.7354 7.62534 14.1171C8.00709 14.4989 8.62647 14.4989 9.00811 14.1171L10.9251 12.2007L12.8416 14.1171C13.2234 14.4989 13.8427 14.4989 14.2244 14.1171C14.6062 13.7354 14.6062 13.1161 14.2244 12.7343L12.3079 10.8179L14.2244 8.90088L14.3123 8.79221C14.5632 8.41306 14.5212 7.89785 14.2244 7.60088C13.9275 7.30404 13.4123 7.26211 13.0331 7.51303L12.9244 7.60088L11.0079 9.51736L9.09138 7.60088L9.00811 7.5181Z"
        fill="currentColor"
      />
    </svg>
  );
}
