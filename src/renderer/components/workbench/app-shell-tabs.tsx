import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { NodexTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface AppShellTabItem {
  id: string;
  title: string;
  icon?: ComponentType<{ className?: string }>;
  closable?: boolean;
  reorderable?: boolean;
  isLabel?: boolean;
  disabled?: boolean;
  titleLabel?: string;
  tooltip?: ReactNode;
  renderPanel: (closeTab: () => void) => ReactNode;
}

interface AppShellTabsProps {
  tabs: AppShellTabItem[];
  activeTabId: string;
  controllerId?: string;
  onSelect: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  onReorderTab?: (activeId: string, overId: string) => void;
  afterList?: ReactNode;
  headerHeight?: "pane" | "toolbar";
  className?: string;
}

export function resolveAppShellTabDrop(
  tabs: readonly AppShellTabItem[],
  activeId: string,
  overId: string | null | undefined,
): { activeId: string; overId: string } | null {
  if (!overId) return null;
  if (activeId === overId) return null;

  const activeIndex = tabs.findIndex((tab) => tab.id === activeId);
  const overIndex = tabs.findIndex((tab) => tab.id === overId);
  if (activeIndex < 0 || overIndex < 0) return null;

  if (tabs.length <= 1 || tabs[activeIndex]?.isLabel === true) return null;

  return { activeId, overId };
}

export function projectAppShellTabOrder(
  tabIds: readonly string[],
  activeDragId: string | null,
  overIndex: number | null,
): string[] {
  if (activeDragId == null || overIndex == null) return [...tabIds];

  const activeIndex = tabIds.indexOf(activeDragId);
  if (activeIndex < 0 || overIndex < 0 || overIndex >= tabIds.length) return [...tabIds];

  return arrayMove([...tabIds], activeIndex, overIndex);
}

export function shouldShowAppShellTabSeparator({
  projectedIndex,
  projectedLength,
  activeProjectedIndex,
  dragProjectedIndex,
  isActive,
  isDragging,
}: {
  projectedIndex: number;
  projectedLength: number;
  activeProjectedIndex: number;
  dragProjectedIndex: number;
  isActive: boolean;
  isDragging: boolean;
}): boolean {
  if (projectedIndex < 0 || projectedIndex >= projectedLength - 1) return false;
  if (isActive || isDragging) return false;
  if (projectedIndex === activeProjectedIndex || projectedIndex === activeProjectedIndex - 1) return false;
  if (projectedIndex === dragProjectedIndex || projectedIndex === dragProjectedIndex - 1) return false;

  return true;
}

export function AppShellTabs({
  tabs,
  activeTabId,
  controllerId = "cards",
  onSelect,
  onCloseTab,
  onReorderTab,
  afterList,
  headerHeight = "pane",
  className,
}: AppShellTabsProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const activePanelId = activeTab ? makeTabPanelId(controllerId, activeTab.id) : undefined;
  const sortableTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const projectedTabIds = useMemo(
    () => projectAppShellTabOrder(sortableTabIds, activeDragId, overIndex),
    [activeDragId, overIndex, sortableTabIds],
  );
  const activeTabProjectedIndex = activeTab ? projectedTabIds.indexOf(activeTab.id) : -1;
  const dragProjectedIndex = activeDragId ? projectedTabIds.indexOf(activeDragId) : -1;
  const isOnlyTab = tabs.length === 1;

  const closeTab = (tabId: string) => {
    onCloseTab?.(tabId);
  };

  const clearDragState = () => {
    setActiveDragId(null);
    setOverIndex(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragMove = (event: DragMoveEvent) => {
    setOverIndex(event.over?.data.current?.sortable.index ?? null);
  };

  const handleDragCancel = () => {
    clearDragState();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    clearDragState();
    const resolvedDrop = resolveAppShellTabDrop(
      tabs,
      String(event.active.id),
      event.over?.id == null ? null : String(event.over.id),
    );
    if (!resolvedDrop) return;
    onReorderTab?.(resolvedDrop.activeId, resolvedDrop.overId);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-token-main-surface-primary", className)}>
      <div
        className={cn(
          "flex min-w-0 shrink-0 items-center bg-token-main-surface-primary px-2",
          headerHeight === "toolbar" ? "h-toolbar" : "h-toolbar-pane",
        )}
      >
        <div
          className="hide-scrollbar relative flex h-full min-w-0 flex-1 scroll-px-1 items-center overflow-x-auto overflow-y-hidden"
          style={{ scrollPaddingInlineEnd: 0 }}
        >
          <div
            aria-hidden="true"
            className="sticky start-0 z-10 h-full w-0 opacity-0 transition-opacity duration-100 after:absolute after:start-0 after:top-0 after:bottom-0 after:w-10 after:bg-linear-to-l after:from-transparent after:to-token-main-surface-primary after:content-[''] after:pointer-events-none"
          />
          <span aria-hidden="true" />
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToHorizontalAxis]}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragCancel={handleDragCancel}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableTabIds} strategy={horizontalListSortingStrategy}>
              <div role="tablist" className="relative z-0 flex" style={{ gap: 3 }}>
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTab?.id;
                  const projectedIndex = projectedTabIds.indexOf(tab.id);
                  return (
                    <SortableAppShellTab
                      key={tab.id}
                      tab={tab}
                      controllerId={controllerId}
                      isOnlyTab={isOnlyTab}
                      isActive={isActive}
                      panelId={activePanelId}
                      separatorIndex={projectedIndex}
                      activeTabProjectedIndex={activeTabProjectedIndex}
                      dragProjectedIndex={dragProjectedIndex}
                      projectedTabCount={projectedTabIds.length}
                      onSelect={onSelect}
                      onClose={tab.closable ? closeTab : undefined}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
          <span aria-hidden="true" />
          <div
            aria-hidden="true"
            className="sticky end-0 z-10 h-full w-0 opacity-0 transition-opacity duration-100 after:absolute after:end-0 after:inset-y-0 after:w-10 after:bg-linear-to-r after:from-transparent after:to-token-main-surface-primary after:content-[''] after:pointer-events-none"
          />
        </div>
        {afterList ? (
          <div className="ml-1 flex shrink-0 items-center gap-1">{afterList}</div>
        ) : null}
      </div>

      {activeTab ? (
        <div
          role="tabpanel"
          id={activePanelId}
          aria-label={activeTab.titleLabel ?? activeTab.title}
          className="relative min-h-0 flex-1"
        >
          {activeTab.renderPanel(() => closeTab(activeTab.id))}
        </div>
      ) : null}
    </div>
  );
}

function SortableAppShellTab({
  tab,
  controllerId,
  isOnlyTab,
  isActive,
  panelId,
  separatorIndex,
  activeTabProjectedIndex,
  dragProjectedIndex,
  projectedTabCount,
  onSelect,
  onClose,
}: {
  tab: AppShellTabItem;
  controllerId: string;
  isOnlyTab: boolean;
  isActive: boolean;
  panelId?: string;
  separatorIndex: number;
  activeTabProjectedIndex: number;
  dragProjectedIndex: number;
  projectedTabCount: number;
  onSelect: (tabId: string) => void;
  onClose?: (tabId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tab.id,
    disabled: {
      draggable: isOnlyTab || tab.isLabel === true,
      droppable: false,
    },
  });
  const Icon = tab.icon;
  const tabId = makeTabId(controllerId, tab.id);
  const titleRef = useRef<HTMLSpanElement | null>(null);
  const titleOverflows = useAppShellTabTitleOverflow(titleRef, tab.title);
  const title = (
    <span
      ref={titleRef}
      data-app-shell-tab-title={tab.id}
      className="inline-block min-w-0 whitespace-nowrap"
    >
      {tab.title}
    </span>
  );

  const closeCurrentTab = () => {
    onClose?.(tab.id);
  };
  const showSeparator = shouldShowAppShellTabSeparator({
    projectedIndex: separatorIndex,
    projectedLength: projectedTabCount,
    activeProjectedIndex: activeTabProjectedIndex,
    dragProjectedIndex,
    isActive,
    isDragging,
  });

  const chrome = (
    <div
      ref={setNodeRef}
      data-app-shell-tab-controller={controllerId}
      data-tab-id={tab.id}
      className={cn(
        "my-auto flex shrink-0 items-center gap-0.5 contain-content relative max-w-40 pe-1",
        isDragging && "z-10 cursor-grab",
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <div
        ref={setActivatorNodeRef}
        data-tab-id={tab.id}
        className="group/tab relative flex max-w-39 shrink-0 items-center overflow-hidden rounded-md bg-token-main-surface-primary px-2 py-1"
        {...attributes}
        {...listeners}
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
          closeCurrentTab();
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
          disabled={tab.disabled}
          className={cn(
            "no-drag relative z-10 flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm",
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
        >
          {Icon ? (
            <span aria-hidden="true" className="icon-xs flex shrink-0 items-center justify-center">
              <Icon className="icon-xs shrink-0" />
            </span>
          ) : null}
          {onClose ? (
            <div
              role="button"
              aria-label={`Close ${tab.titleLabel ?? tab.title} tab`}
              className="no-drag absolute start-0 inset-y-0 z-30 hidden shrink-0 cursor-interaction items-center bg-(--app-shell-tab-background) text-token-text-tertiary hover:text-token-text-primary group-hover/tab:flex after:absolute after:-inset-2 after:content-['']"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                closeCurrentTab();
              }}
            >
              <CodexTabCloseIcon className="icon-xs" />
            </div>
          ) : null}
          {tab.tooltip ? (
            <NodexTooltip
              tooltipContent={tab.tooltip}
              disabled={isDragging}
              delayOpen
              side="bottom"
              align="start"
            >
              {title}
            </NodexTooltip>
          ) : title}
        </button>
        {titleOverflows ? (
          <div
            aria-hidden="true"
            data-app-shell-tab-title-fade={tab.id}
            className={cn(
              "pointer-events-none absolute inset-y-0 end-0 z-20 w-8 bg-linear-to-r from-transparent to-60%",
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
    </div>
  );

  if (!onClose) {
    return chrome;
  }

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{chrome}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className="no-drag bg-token-dropdown-background/90 text-token-foreground ring-token-border z-50 m-px min-w-36 select-none overflow-hidden rounded-xl px-1 py-1 shadow-xl-spread ring-[0.5px] backdrop-blur-sm"
        >
          <ContextMenuPrimitive.Item
            className="cursor-interaction rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm outline-hidden hover:bg-token-list-hover-background focus:bg-token-list-hover-background"
            onSelect={closeCurrentTab}
          >
            Close tab
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
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
