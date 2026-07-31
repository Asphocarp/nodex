import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, type MotionValue } from "motion/react";
import type {
  CodexSidebarChatsThreadOrderInput,
} from "../../../shared/codex-sidebar-thread-move";
import { codexSidebarProjectThreadContainerId } from "../../../shared/codex-sidebar-thread-move";
import type { LibraryRouteTarget } from "../../../shared/library-module";
import type { LibraryResourceTarget } from "../library/library-resource-actions";
import {
  CodexProjectRow,
  CodexProjectSessionList,
  CodexSidebarActionButton,
  CodexSidebarSection,
  CodexSidebarThreadRow,
  CodexSidebarTopActionButton,
  resolveCodexNewChatShortcutLabel,
  resolveCodexPageSearchShortcutLabel,
} from "./codex-sidebar";
import { LeftSidebarFooter } from "./left-sidebar-footer";
import { SidebarDropIndicator } from "./sidebar-drop-indicator";
import type { SidebarLibraryDragResource } from "./sidebar-library-dnd";
import { SidebarLibrarySection } from "./sidebar-library-section";
import {
  SIDEBAR_SCROLL_AREA_CLASS,
  SidebarExpandedHeader,
  getSidebarScrollChromeStyle,
} from "./sidebar-new-chat-controls";
import {
  SidebarProjectSortableContext,
  replaceVisibleOrder,
  useSidebarGroupReorderController,
  type SidebarGroupDndController,
} from "./sidebar-project-group-dnd";
import { SidebarProjectsSectionActions } from "./sidebar-projects-section-actions";
import { SidebarReorderDndProvider } from "./sidebar-reorder-dnd";
import {
  SidebarThreadDropContainer,
  SidebarThreadReorderRows,
  SidebarThreadSortableRows,
  resolveSidebarThreadKeysWithPendingDrops,
  usePendingSidebarThreadDrops,
  useSidebarPinnedDropContainer,
  useSidebarThreadReorderController,
  type SidebarThreadDropRequest,
} from "./sidebar-thread-reorder";
import type { StableWorktreeEntry } from "./stable-worktree-production";
import { StableWorktreeSidebarRows } from "./stable-worktree-sidebar-row";
import {
  CodexAutomationsIcon,
  CodexNewChatIcon,
  CodexThreadIcon,
  ComposerPluginsIcon,
} from "@/components/shared/icons";
import {
  NodexDialog,
  NodexDialogAction,
  NodexDialogBody,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogFrame,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { invoke } from "@/lib/api";
import {
  CODEX_SIDEBAR_FLOATING_ASIDE_CLASS,
  CODEX_SIDEBAR_WIDTH_DEFAULT_PX,
} from "@/lib/codex-sidebar-auto-reveal";
import {
  CODEX_SIDEBAR_DEFAULT_PAGER_ROW_CLASS,
  CODEX_SIDEBAR_PAGER_BUTTON_CLASS,
  CODEX_SIDEBAR_PROJECTLESS_THREAD_MAX_ITEMS,
  CODEX_SIDEBAR_PROJECT_GROUP_MAX_GROUPS,
  CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS,
  CODEX_SIDEBAR_PROJECT_THREAD_PAGER_ROW_CLASS,
  paginateCodexSidebarItems,
  type CodexSidebarPaginationResult,
} from "@/lib/codex-sidebar-pagination";
import {
  buildCodexSidebarPinnedReorderMutation,
  listReorderableCodexSidebarProjectThreadKeys,
  orderCodexSidebarThreadKeysByManualThreadIds,
  replaceVisibleCodexSidebarThreadKeyOrder,
  resolveCodexSidebarThreadHomeContainerId,
  sortSidebarThreadKeysForDisplay,
  type CodexSidebarProjectGroup,
  type CodexSidebarThreadSyncModel,
} from "@/lib/codex-sidebar-thread-sync";
import {
  buildLibraryMoveOperation,
  buildLibraryProjectGrantOperation,
} from "@/lib/library-operations";
import { projectActivitySummariesQueryOptions } from "@/lib/query-options";
import {
  listExpandedVisibleProjectGroupIds,
  listReopenableVisibleProjectGroupIds,
  resolveSidebarProjectGroupCollapseAction,
  type SidebarProjectGroupCollapseAction,
} from "@/lib/sidebar-project-group-collapse-action";
import type {
  CodexAccountSnapshot,
  CodexConnectionState,
  CodexSidebarThreadItem,
  Project,
  ProjectCreateInput,
  ProjectLifecycleMutationResult,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
  ProjectUpdateInput,
} from "@/lib/types";
import { useCodexAccountActions } from "@/lib/use-codex-account-actions";
import { useApplyLibraryOperation } from "@/lib/use-library-navigation";
import { cn } from "@/lib/utils";
import {
  projectSessionProjectionsByProject,
  type WorkbenchSessionCollection,
  type WorkbenchSessionCollectionState,
} from "@/lib/use-workbench-session-catalog";
import type { WorkbenchSessionRenderProjection } from "@/lib/workbench-session-presentation";

type ProjectSession = WorkbenchSessionRenderProjection;
const IDLE_SESSION_COLLECTION_STATE = { kind: "idle" } as const;

function SidebarSessionCollectionFallback({
  state,
  loadingText,
  emptyText,
  placement,
  onRetry,
}: {
  state: WorkbenchSessionCollectionState;
  loadingText: string | null;
  emptyText: string | null;
  placement: "section" | "project-child";
  onRetry: () => void | Promise<void>;
}) {
  const rowClassName = cn(
    "py-row-y text-sm",
    placement === "project-child" ? "pr-row-x pl-8" : "px-row-x",
  );

  if (state.kind === "loading") {
    if (!loadingText) return null;
    return (
      <div className={cn(rowClassName, "text-token-description-foreground")} role="listitem">
        {loadingText}
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={rowClassName} role="listitem">
        <button
          type="button"
          className="text-token-description-foreground hover:text-token-foreground"
          title={state.message}
          aria-label={`Retry chats: ${state.message}`}
          onClick={() => void onRetry()}
        >
          Retry chats
        </button>
      </div>
    );
  }

  if (state.kind !== "ready" || !emptyText) return null;

  return (
    <div className={cn(rowClassName, "text-token-description-foreground")} role="listitem">
      {emptyText}
    </div>
  );
}

export type SidebarResizePhase = "live" | "end" | "reset";
export type SidebarResizeSurface = "inline" | "floating";

function reportSidebarThreadReorderError(): void {
  toast.danger("Couldn’t reorder task");
}

function reportSidebarProjectReorderError(): void {
  toast.danger("Couldn’t reorder project");
}

interface CodexSidebarPaginatedItemsProps<T> {
  items: T[];
  getKey: (item: T) => string;
  maxItems?: number | null;
  expanded: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  forcedVisibleKey?: string | null;
  suppressedKeys?: ReadonlySet<string>;
  pagerClassName?: string;
  hasMoreAtSource?: boolean;
  onLoadMore?: () => void | Promise<void>;
  children: (
    pagination: CodexSidebarPaginationResult<T>,
    pager: ReactNode,
  ) => ReactNode;
}

function CodexSidebarPaginatedItems<T>({
  items,
  getKey,
  maxItems = null,
  expanded,
  onExpandedChange,
  forcedVisibleKey = null,
  suppressedKeys,
  pagerClassName = CODEX_SIDEBAR_DEFAULT_PAGER_ROW_CLASS,
  hasMoreAtSource = false,
  onLoadMore,
  children,
}: CodexSidebarPaginatedItemsProps<T>) {
  const [extraPageCount, setExtraPageCount] = useState(1);
  const focusRestoreTargetRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (expanded) return;
    setExtraPageCount(1);
  }, [expanded]);

  const pagination = useMemo(() => paginateCodexSidebarItems({
    items,
    getKey,
    maxItems,
    expanded,
    extraPageCount,
    forcedVisibleKey,
    suppressedKeys,
    pagerEnabled: Boolean(onExpandedChange),
  }), [
    expanded,
    extraPageCount,
    forcedVisibleKey,
    getKey,
    items,
    maxItems,
    onExpandedChange,
    suppressedKeys,
  ]);

  const restorePagerFocus = useCallback(() => {
    queueMicrotask(() => {
      focusRestoreTargetRef.current?.focus();
    });
  }, []);

  const showMore = useCallback(() => {
    if (!expanded) {
      if (hasMoreAtSource) {
        void onLoadMore?.();
      }
      setExtraPageCount(1);
      onExpandedChange?.(true);
      restorePagerFocus();
      return;
    }

    if (hasMoreAtSource) {
      void onLoadMore?.();
    }
    setExtraPageCount((current) => current + 1);
    restorePagerFocus();
  }, [
    expanded,
    hasMoreAtSource,
    onExpandedChange,
    onLoadMore,
    restorePagerFocus,
  ]);

  const showLess = useCallback(() => {
    setExtraPageCount(1);
    onExpandedChange?.(false);
    restorePagerFocus();
  }, [onExpandedChange, restorePagerFocus]);

  const hasOverflow = pagination.hasOverflow || hasMoreAtSource;
  const pager = pagination.showPager || hasMoreAtSource ? (
    <div className={pagerClassName} role="listitem">
      {hasOverflow ? (
        <button
          ref={focusRestoreTargetRef}
          type="button"
          className={CODEX_SIDEBAR_PAGER_BUTTON_CLASS}
          onClick={showMore}
        >
          Show more
        </button>
      ) : null}
      {expanded ? (
        <button
          ref={hasOverflow ? undefined : focusRestoreTargetRef}
          type="button"
          className={CODEX_SIDEBAR_PAGER_BUTTON_CLASS}
          onClick={showLess}
        >
          Show less
        </button>
      ) : null}
    </div>
  ) : null;

  return <>{children(pagination, pager)}</>;
}

function SidebarProjectGroupRowsContent({
  visibleItems,
  pager,
  emptyText,
  loading,
  reorderGroups,
  renderProjectGroup,
}: {
  visibleItems: CodexSidebarProjectGroup[];
  pager: ReactNode;
  emptyText: string;
  loading: boolean;
  reorderGroups: (nextVisibleGroupIds: string[]) => void | Promise<void>;
  renderProjectGroup: (
    group: CodexSidebarProjectGroup,
    controller: SidebarGroupDndController,
  ) => ReactNode;
}) {
  const visibleGroupIds = useMemo(
    () => visibleItems.map((group) => group.project.id),
    [visibleItems],
  );
  const visibleGroupById = useMemo(
    () => new Map(visibleItems.map((group) => [group.project.id, group] as const)),
    [visibleItems],
  );
  const reorder = useSidebarGroupReorderController({
    groupIds: visibleGroupIds,
    reorderGroups,
  });
  const orderedVisibleItems = useMemo(
    () => reorder.groupIds
      .map((projectId) => visibleGroupById.get(projectId))
      .filter((group): group is CodexSidebarProjectGroup => Boolean(group)),
    [reorder.groupIds, visibleGroupById],
  );

  return (
    <div className="isolate flex flex-col [contain:layout]">
      <SidebarProjectSortableContext groupIds={reorder.groupIds}>
        <div className="flex flex-col" role="list" aria-label="Projects">
          {orderedVisibleItems.length > 0 ? orderedVisibleItems.map((group, index) => (
            <Fragment key={group.project.id}>
              {reorder.dropIndicatorIndex === index ? <SidebarDropIndicator /> : null}
              {renderProjectGroup(group, reorder.controller)}
            </Fragment>
          )) : (
            <div className="px-row-x py-row-y text-sm text-token-description-foreground" role="listitem">
              {loading ? "Loading projects..." : emptyText}
            </div>
          )}
          {reorder.dropIndicatorIndex === orderedVisibleItems.length ? <SidebarDropIndicator /> : null}
          {pager}
        </div>
      </SidebarProjectSortableContext>
    </div>
  );
}

function SidebarPinnedThreadRowsContent({
  containerId,
  getThreadId,
  visibleThreadKeys,
  itemsByKey,
  ariaLabel,
  onVisibleThreadOrderChange,
  renderThread,
}: {
  containerId: "pinned";
  getThreadId: (threadKey: string) => string | null;
  visibleThreadKeys: string[];
  itemsByKey: ReadonlyMap<string, CodexSidebarThreadItem>;
  ariaLabel: string;
  onVisibleThreadOrderChange: (change: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => Promise<void>;
  renderThread: (threadKey: string) => ReactNode;
}) {
  const pendingThreadDrops = usePendingSidebarThreadDrops();
  const optimisticThreadKeys = resolveSidebarThreadKeysWithPendingDrops({
    containerId,
    pendingThreadDrops,
    threadKeys: visibleThreadKeys,
    getThreadId,
  });
  return (
    <div className="isolate flex flex-col [contain:layout]">
      <div className="flex flex-col" role="list" aria-label={ariaLabel}>
        <SidebarThreadReorderRows
          containerId={containerId}
          getThreadId={getThreadId}
          visibleThreadKeys={optimisticThreadKeys}
          sortableThreadKeys={optimisticThreadKeys}
          onVisibleThreadOrderChange={onVisibleThreadOrderChange}
          renderThread={renderThread}
          renderDragOverlay={(threadKey) => {
            const item = itemsByKey.get(threadKey);
            if (!item) return null;
            return (
              <div className="flex h-[var(--height-token-nav-row)] max-w-80 items-center gap-2 px-2 text-base text-token-foreground">
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <CodexThreadIcon className="icon-xs" />
                </span>
                <span className="min-w-0 truncate">{item.title}</span>
              </div>
            );
          }}
          sourceProjectKind="local"
          targetProjectKind="local"
        />
      </div>
    </div>
  );
}

function SidebarThreadContainerRowsContent({
  containerId,
  threadKeys,
  getThreadId,
  itemsByKey,
  expanded,
  onExpandedChange,
  forcedVisibleKey,
  suppressedKeys,
  collectionState,
  hasMoreAtSource,
  onLoadMore,
  onRetry,
  onVisibleThreadOrderChange,
  renderThread,
}: {
  containerId: "chats";
  threadKeys: string[];
  getThreadId: (threadKey: string) => string | null;
  itemsByKey: ReadonlyMap<string, CodexSidebarThreadItem>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  forcedVisibleKey: string | null;
  suppressedKeys: ReadonlySet<string>;
  collectionState: WorkbenchSessionCollectionState;
  hasMoreAtSource: boolean;
  onLoadMore: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onVisibleThreadOrderChange: (change: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => Promise<void>;
  renderThread: (threadKey: string) => ReactNode;
}) {
  const pendingThreadDrops = usePendingSidebarThreadDrops();
  const optimisticThreadKeys = resolveSidebarThreadKeysWithPendingDrops({
    containerId,
    pendingThreadDrops,
    threadKeys,
    threadKeysInDisplayOrder: threadKeys,
    getThreadId,
  });
  const sortableThreadKeys = optimisticThreadKeys.filter((threadKey) => (
    getThreadId(threadKey) !== null && !suppressedKeys.has(threadKey)
  ));
  const reorder = useSidebarThreadReorderController({
    visibleThreadKeys: sortableThreadKeys,
    onVisibleThreadOrderChange,
  });
  const displayedThreadKeys = replaceVisibleCodexSidebarThreadKeyOrder({
    threadKeysInDisplayOrder: optimisticThreadKeys,
    visibleThreadKeys: sortableThreadKeys,
    nextVisibleThreadKeys: reorder.displayedVisibleThreadKeys,
  });

  return (
    <SidebarThreadDropContainer containerId={containerId} targetProjectKind="local">
      <CodexSidebarPaginatedItems
        items={displayedThreadKeys}
        getKey={(threadKey) => threadKey}
        maxItems={CODEX_SIDEBAR_PROJECTLESS_THREAD_MAX_ITEMS}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        forcedVisibleKey={forcedVisibleKey}
        suppressedKeys={suppressedKeys}
        hasMoreAtSource={hasMoreAtSource}
        onLoadMore={onLoadMore}
      >
        {(pagination, pager) => (
          <div className="isolate flex flex-col [contain:layout]">
            <div className="flex flex-col" role="list" aria-label="Chats">
              {pagination.visibleItems.length > 0 ? (
                <SidebarThreadSortableRows
                  containerId={containerId}
                  getThreadId={getThreadId}
                  visibleThreadKeys={pagination.visibleItems}
                  sortableThreadKeysInDisplayOrder={reorder.displayedVisibleThreadKeys}
                  controller={reorder.controller}
                  dropIndicatorTarget={reorder.dropIndicatorTarget}
                  renderThread={renderThread}
                  renderDragOverlay={(threadKey) => {
                    const item = itemsByKey.get(threadKey);
                    if (!item) return null;
                    return (
                      <div className="flex h-[var(--height-token-nav-row)] max-w-80 items-center gap-2 px-2 text-base text-token-foreground">
                        <span className="flex size-5 shrink-0 items-center justify-center">
                          <CodexThreadIcon className="icon-xs" />
                        </span>
                        <span className="min-w-0 truncate">{item.title}</span>
                      </div>
                    );
                  }}
                  sourceProjectKind="local"
                  targetProjectKind="local"
                />
              ) : null}
              {pagination.visibleItems.length === 0
                || collectionState.kind === "error" ? (
                <SidebarSessionCollectionFallback
                  state={collectionState}
                  loadingText="Loading chats..."
                  emptyText="No projectless chats"
                  placement="section"
                  onRetry={onRetry}
                />
              ) : null}
              {pager}
            </div>
          </div>
        )}
      </CodexSidebarPaginatedItems>
    </SidebarThreadDropContainer>
  );
}

function SidebarProjectThreadRowsContent({
  project,
  pinnedThreadKeys,
  sortablePinnedThreadKeys,
  threadKeys,
  expanded,
  forcedVisibleKey,
  suppressedKeys,
  collectionState,
  hasMoreAtSource,
  onLoadMore,
  onRetry,
  onExpandedChange,
  onPinnedThreadOrderChange,
  onProjectThreadOrderChange,
  getThreadId,
  itemsByKey,
  renderThread,
}: {
  project: Project;
  pinnedThreadKeys: string[];
  sortablePinnedThreadKeys: string[];
  threadKeys: string[];
  expanded: boolean;
  forcedVisibleKey: string | null;
  suppressedKeys: ReadonlySet<string>;
  collectionState: WorkbenchSessionCollectionState;
  hasMoreAtSource: boolean;
  onLoadMore: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onExpandedChange: (expanded: boolean) => void;
  onPinnedThreadOrderChange: (change: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => Promise<void>;
  onProjectThreadOrderChange: (projectId: string, orderedThreadIds: string[]) => Promise<void>;
  getThreadId: (threadKey: string) => string | null;
  itemsByKey: ReadonlyMap<string, CodexSidebarThreadItem>;
  renderThread: (threadKey: string) => ReactNode;
}) {
  const pinnedContainerId = codexSidebarProjectThreadContainerId(project.id, true);
  const regularContainerId = codexSidebarProjectThreadContainerId(project.id, false);
  const pendingThreadDrops = usePendingSidebarThreadDrops();
  const optimisticPinnedThreadKeys = useMemo(() => resolveSidebarThreadKeysWithPendingDrops({
    containerId: pinnedContainerId,
    pendingThreadDrops,
    threadKeys: pinnedThreadKeys,
    getThreadId,
  }), [getThreadId, pendingThreadDrops, pinnedContainerId, pinnedThreadKeys]);
  const optimisticRegularThreadKeys = useMemo(() => resolveSidebarThreadKeysWithPendingDrops({
    containerId: regularContainerId,
    pendingThreadDrops,
    threadKeys,
    threadKeysInDisplayOrder: threadKeys,
    getThreadId,
  }), [
    getThreadId,
    pendingThreadDrops,
    regularContainerId,
    threadKeys,
  ]);
  const sortablePinnedThreadKeySet = useMemo(
    () => new Set(sortablePinnedThreadKeys),
    [sortablePinnedThreadKeys],
  );
  const optimisticSortablePinnedThreadKeys = useMemo(() => optimisticPinnedThreadKeys.filter(
    (threadKey) => sortablePinnedThreadKeySet.has(threadKey) && !suppressedKeys.has(threadKey),
  ), [optimisticPinnedThreadKeys, sortablePinnedThreadKeySet, suppressedKeys]);
  const sortableRegularThreadKeys = useMemo(() => listReorderableCodexSidebarProjectThreadKeys({
    visibleThreadKeys: optimisticRegularThreadKeys.filter(
      (threadKey) => !suppressedKeys.has(threadKey),
    ),
    getThreadId,
  }), [getThreadId, optimisticRegularThreadKeys, suppressedKeys]);
  const persistVisibleRegularThreadOrder = useCallback(async ({
    visibleThreadKeys,
    nextVisibleThreadKeys,
  }: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => {
    const orderedThreadIds = nextVisibleThreadKeys.flatMap((threadKey) => {
      const threadId = getThreadId(threadKey);
      return threadId ? [threadId] : [];
    });
    if (orderedThreadIds.length !== visibleThreadKeys.length) return;
    await onProjectThreadOrderChange(project.id, orderedThreadIds);
  }, [getThreadId, onProjectThreadOrderChange, project.id]);
  const pinnedReorder = useSidebarThreadReorderController({
    visibleThreadKeys: optimisticSortablePinnedThreadKeys,
    onVisibleThreadOrderChange: onPinnedThreadOrderChange,
  });
  const regularReorder = useSidebarThreadReorderController({
    visibleThreadKeys: sortableRegularThreadKeys,
    onVisibleThreadOrderChange: persistVisibleRegularThreadOrder,
  });
  const displayedPinnedThreadKeys = useMemo(() => replaceVisibleCodexSidebarThreadKeyOrder({
    threadKeysInDisplayOrder: optimisticPinnedThreadKeys,
    visibleThreadKeys: optimisticSortablePinnedThreadKeys,
    nextVisibleThreadKeys: pinnedReorder.displayedVisibleThreadKeys,
  }), [
    optimisticPinnedThreadKeys,
    optimisticSortablePinnedThreadKeys,
    pinnedReorder.displayedVisibleThreadKeys,
  ]);
  const displayedRegularThreadKeys = useMemo(() => replaceVisibleCodexSidebarThreadKeyOrder({
    threadKeysInDisplayOrder: optimisticRegularThreadKeys,
    visibleThreadKeys: sortableRegularThreadKeys,
    nextVisibleThreadKeys: regularReorder.displayedVisibleThreadKeys,
  }), [
    optimisticRegularThreadKeys,
    regularReorder.displayedVisibleThreadKeys,
    sortableRegularThreadKeys,
  ]);
  const displayedThreadKeys = useMemo(
    () => [...displayedPinnedThreadKeys, ...displayedRegularThreadKeys],
    [displayedPinnedThreadKeys, displayedRegularThreadKeys],
  );
  const renderDragOverlay = (threadKey: string) => {
    const item = itemsByKey.get(threadKey);
    if (!item) return null;
    return (
      <div className="flex h-[var(--height-token-nav-row)] max-w-80 items-center gap-2 px-2 text-base text-token-foreground">
        <span className="flex size-5 shrink-0 items-center justify-center">
          <CodexThreadIcon className="icon-xs" />
        </span>
        <span className="min-w-0 truncate">{item.title}</span>
      </div>
    );
  };

  return (
    <CodexSidebarPaginatedItems
      items={displayedThreadKeys}
      getKey={(threadKey) => threadKey}
      maxItems={CODEX_SIDEBAR_PROJECT_THREAD_MAX_ITEMS}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      forcedVisibleKey={forcedVisibleKey}
      suppressedKeys={suppressedKeys}
      pagerClassName={CODEX_SIDEBAR_PROJECT_THREAD_PAGER_ROW_CLASS}
      hasMoreAtSource={hasMoreAtSource}
      onLoadMore={onLoadMore}
    >
      {(pagination, pager) => {
        const pinnedThreadKeySet = new Set(displayedPinnedThreadKeys);
        const visiblePinnedThreadKeys = pagination.visibleItems.filter((threadKey) => (
          pinnedThreadKeySet.has(threadKey)
        ));
        const visibleRegularThreadKeys = pagination.visibleItems.filter((threadKey) => (
          !pinnedThreadKeySet.has(threadKey)
        ));

        return (
          <CodexProjectSessionList project={project} showAll={expanded}>
            <SidebarThreadDropContainer
              containerId={pinnedContainerId}
              targetProjectKind="local"
            >
              <SidebarThreadSortableRows
                containerId={pinnedContainerId}
                getThreadId={getThreadId}
                visibleThreadKeys={visiblePinnedThreadKeys}
                sortableThreadKeysInDisplayOrder={pinnedReorder.displayedVisibleThreadKeys}
                controller={pinnedReorder.controller}
                dropIndicatorTarget={pinnedReorder.dropIndicatorTarget}
                renderThread={renderThread}
                renderDragOverlay={renderDragOverlay}
                sourceProjectKind="local"
                targetProjectKind="local"
              />
            </SidebarThreadDropContainer>
            <SidebarThreadDropContainer
              containerId={regularContainerId}
              targetProjectKind="local"
            >
              <SidebarThreadSortableRows
                containerId={regularContainerId}
                getThreadId={getThreadId}
                visibleThreadKeys={visibleRegularThreadKeys}
                sortableThreadKeysInDisplayOrder={regularReorder.displayedVisibleThreadKeys}
                controller={regularReorder.controller}
                dropIndicatorTarget={regularReorder.dropIndicatorTarget}
                renderThread={renderThread}
                renderDragOverlay={renderDragOverlay}
                sourceProjectKind="local"
                targetProjectKind="local"
              />
            </SidebarThreadDropContainer>
            {pagination.visibleItems.length === 0
              || collectionState.kind === "error" ? (
              <SidebarSessionCollectionFallback
                state={collectionState}
                loadingText={null}
                emptyText="No chats inside"
                placement="project-child"
                onRetry={onRetry}
              />
            ) : null}
            <SidebarThreadDropContainer
              containerId={regularContainerId}
              projectDropZone="project-pagination"
              targetProjectKind="local"
            >
              {pager}
            </SidebarThreadDropContainer>
          </CodexProjectSessionList>
        );
      }}
    </CodexSidebarPaginatedItems>
  );
}

function SidebarThreadOrganizerSections({
  libraryWorkspaceEnabled,
  activeProjectId,
  activeSessionId,
  activePendingClientThreadId,
  contextMenuSessionId,
  sessionCollectionsByProject,
  projectlessSessionCollection,
  expandedProjectIds,
  pinnedThreadsSectionCollapsed,
  librarySectionCollapsed,
  projectsSectionCollapsed,
  chatsSectionCollapsed,
  onLoadMoreTaskWindow,
  onRetryTaskWindow,
  model,
  onHoverSurfaceOpenChange,
  onTogglePinnedThreadsSectionCollapsed,
  onToggleLibrarySectionCollapsed,
  onToggleProjectsSectionCollapsed,
  onToggleChatsSectionCollapsed,
  onToggleProjectExpanded,
  onSelectProject,
  onSelectSidebarThread,
  onPreviewSidebarThread,
  onOpenSessionContextMenu,
  onSessionTitleDoubleClick,
  onPendingWorktreeTitleDoubleClick,
  onArchiveSidebarThread,
  onArchiveThreadItem,
  onMarkThreadItemRead,
  onThreadsChanged,
  onToggleSessionPinned,
  onToggleSidebarThreadPinned,
  onStartNewChatInProject,
  pendingStableWorktrees,
  onOpenStableWorktree,
  onCreateStableWorktree,
  projectPickerOpenTick,
  onCreateProject,
  onUpdateProject,
  onArchiveProject,
  onReorderProjects,
  onSetProjectPinned,
  onSetPinnedProjectOrder,
  onReorderProjectThreads,
  onReorderChatsThreads,
  onReorderPinnedThreads,
  sidebarArchivePendingKeys,
  onOpenLibrary,
  onOpenLibraryTarget,
  onOpenLibraryTargetInProject,
  activeLibraryTarget,
  hasMoreProjects,
  loadingMoreProjects,
  onLoadMoreProjects,
}: {
  libraryWorkspaceEnabled: boolean;
  activeProjectId: string | null;
  activeSessionId: string | null;
  activePendingClientThreadId?: string | null;
  contextMenuSessionId?: string | null;
  sessionCollectionsByProject: Readonly<
    Record<string, WorkbenchSessionCollection>
  >;
  projectlessSessionCollection: WorkbenchSessionCollection;
  expandedProjectIds: Set<string>;
  pinnedThreadsSectionCollapsed: boolean;
  librarySectionCollapsed: boolean;
  projectsSectionCollapsed: boolean;
  chatsSectionCollapsed: boolean;
  onLoadMoreTaskWindow: (projectId: string | null) => Promise<void>;
  onRetryTaskWindow: (projectId: string | null) => Promise<void>;
  model: CodexSidebarThreadSyncModel;
  onHoverSurfaceOpenChange?: (open: boolean) => void;
  onTogglePinnedThreadsSectionCollapsed: () => void;
  onToggleLibrarySectionCollapsed: () => void;
  onToggleProjectsSectionCollapsed: () => void;
  onToggleChatsSectionCollapsed: () => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSidebarThread: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onPreviewSidebarThread?: (item: CodexSidebarThreadItem) => void;
  onOpenSessionContextMenu?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onSessionTitleDoubleClick?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onPendingWorktreeTitleDoubleClick?: (
    item: CodexSidebarThreadItem,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onArchiveSidebarThread?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onArchiveThreadItem?: (item: CodexSidebarThreadItem) => Promise<boolean>;
  onMarkThreadItemRead?: (item: CodexSidebarThreadItem) => Promise<void>;
  onThreadsChanged?: () => Promise<unknown> | void;
  onToggleSessionPinned?: (session: ProjectSession) => void | Promise<void>;
  onToggleSidebarThreadPinned?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onStartNewChatInProject: (projectId: string | null) => void | Promise<void>;
  pendingStableWorktrees: readonly StableWorktreeEntry[];
  onOpenStableWorktree: (pendingWorktreeId: string) => void;
  onCreateStableWorktree: (project: Project, projectName: string) => Promise<void>;
  projectPickerOpenTick: number;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onArchiveProject: (projectId: string) => Promise<ProjectLifecycleMutationResult>;
  onReorderProjects: (input: ProjectOrderInput) => Promise<void>;
  onSetProjectPinned: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onSetPinnedProjectOrder: (input: ProjectPinnedOrderInput) => Promise<void>;
  onReorderProjectThreads: (projectId: string, orderedThreadIds: string[]) => Promise<void>;
  onReorderChatsThreads: (input: CodexSidebarChatsThreadOrderInput) => Promise<void>;
  onReorderPinnedThreads: (orderedThreadIds: readonly string[]) => Promise<unknown>;
  sidebarArchivePendingKeys: ReadonlySet<string>;
  onOpenLibrary: () => void;
  onOpenLibraryTarget: (target: LibraryRouteTarget) => void;
  onOpenLibraryTargetInProject?: (
    projectId: string,
    target: LibraryResourceTarget,
    title: string,
  ) => void | Promise<void>;
  activeLibraryTarget: LibraryRouteTarget | null;
  hasMoreProjects: boolean;
  loadingMoreProjects: boolean;
  onLoadMoreProjects?: () => Promise<void>;
}) {
  const sessionsByProject = useMemo<Record<string, ProjectSession[]>>(
    () => projectSessionProjectionsByProject(sessionCollectionsByProject),
    [sessionCollectionsByProject],
  );
  const projectlessSessions = useMemo(
    () => [...projectlessSessionCollection.projections],
    [projectlessSessionCollection.projections],
  );
  const [pinnedProjectsExpanded, setPinnedProjectsExpanded] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [expandedProjectThreadListIds, setExpandedProjectThreadListIds] = useState<Set<string>>(new Set());
  const [projectlessThreadListExpanded, setProjectlessThreadListExpanded] = useState(false);
  const [previouslyExpandedProjectGroupIds, setPreviouslyExpandedProjectGroupIds] = useState<string[]>([]);
  const openHoverSurfaceKeysRef = useRef(new Set<string>());
  const setSidebarHoverSurfaceOpen = useCallback((
    key: string,
    open: boolean,
  ) => {
    const openKeys = openHoverSurfaceKeysRef.current;
    if (open) {
      openKeys.add(key);
    } else {
      openKeys.delete(key);
    }
    onHoverSurfaceOpenChange?.(openKeys.size > 0);
  }, [onHoverSurfaceOpenChange]);
  const pinnedDropTarget = useSidebarPinnedDropContainer();
  const sessionsById = useMemo(() => {
    const entries = [
      ...Object.values(sessionsByProject).flat(),
      ...projectlessSessions,
    ].map((session) => [session.id, session] as const);
    return new Map(entries);
  }, [projectlessSessions, sessionsByProject]);
  const knownSessions = useMemo(
    () => [...Object.values(sessionsByProject).flat(), ...projectlessSessions],
    [projectlessSessions, sessionsByProject],
  );
  const sessionsByThreadId = useMemo(() => {
    const entries = knownSessions
      .filter((session) => session.thread)
      .map((session) => [session.thread?.threadId ?? "", session] as const);
    return new Map(entries);
  }, [knownSessions]);
  const fallbackThreadItems = useMemo(() => {
    const existingSessionIds = new Set(
      model.snapshot.items
        .map((item) => item.sessionId)
        .filter((sessionId): sessionId is string => typeof sessionId === "string"),
    );
    const existingThreadIds = new Set(model.snapshot.items.map((item) => item.threadId));
    return knownSessions
      .filter((session) => !session.archived)
      .filter((session) => {
        if (existingSessionIds.has(session.id)) return false;
        if (session.thread && existingThreadIds.has(session.thread.threadId)) return false;
        return true;
      })
      .map((session): CodexSidebarThreadItem => {
        const threadId = session.thread?.threadId ?? session.id;
        return {
          key: `local:session:${session.id}`,
          kind: "local",
          hostId: "local",
          threadId,
          sessionId: session.id,
          projectId: session.projectId,
          title: session.displayTitle,
          preview: session.thread?.threadPreview ?? "",
          cwd: session.thread?.cwd ?? null,
          updatedAt: session.thread?.updatedAt ?? Date.parse(session.updatedAt),
          createdAt: session.thread?.createdAt ?? Date.parse(session.createdAt),
          pinned: session.pinned,
          pinnedOrder: session.pinnedOrder,
          unread: session.unread,
          archived: session.archived || session.thread?.archived === true,
          statusType: (session.thread?.statusType ?? "notLoaded") as CodexSidebarThreadItem["statusType"],
          statusActiveFlags: (session.thread?.statusActiveFlags ?? []) as CodexSidebarThreadItem["statusActiveFlags"],
          projectless: session.projectId === null,
          disabled: false,
        };
      });
  }, [knownSessions, model.snapshot.items]);
  const sidebarThreadItemsByKey = useMemo(() => {
    const itemsByKey = new Map(model.threadItemsByKey);
    for (const item of fallbackThreadItems) {
      itemsByKey.set(item.key, item);
    }
    return itemsByKey;
  }, [fallbackThreadItems, model.threadItemsByKey]);
  const getSidebarRealThreadId = useCallback((threadKey: string) => {
    const item = sidebarThreadItemsByKey.get(threadKey);
    if (!item || item.pendingWorktreeId) return null;
    if (model.threadItemsByKey.has(threadKey)) return item.threadId;
    const session = item.sessionId
      ? sessionsById.get(item.sessionId)
      : sessionsByThreadId.get(item.threadId);
    return session?.thread?.threadId ?? null;
  }, [model.threadItemsByKey, sessionsById, sessionsByThreadId, sidebarThreadItemsByKey]);
  const allPinnedThreadKeys = useMemo(() => {
    const fallbackPinnedThreadKeys = sortSidebarThreadKeysForDisplay({
      threadKeys: fallbackThreadItems
        .filter((item) => item.pinned)
        .map((item) => item.key),
      itemsByKey: sidebarThreadItemsByKey,
      sessionsById,
    });
    return [...model.pinnedThreadKeys, ...fallbackPinnedThreadKeys];
  }, [fallbackThreadItems, model.pinnedThreadKeys, sessionsById, sidebarThreadItemsByKey]);
  const knownProjectIds = useMemo(
    () => new Set(model.projectGroups.map((group) => group.project.id)),
    [model.projectGroups],
  );
  const pinnedStandaloneThreadKeys = useMemo(() => allPinnedThreadKeys.filter((threadKey) => {
    const projectId = sidebarThreadItemsByKey.get(threadKey)?.projectId ?? null;
    return projectId === null || !knownProjectIds.has(projectId);
  }), [allPinnedThreadKeys, knownProjectIds, sidebarThreadItemsByKey]);
  const sortablePinnedStandaloneThreadKeys = useMemo(() =>
    pinnedStandaloneThreadKeys.filter((threadKey) =>
      model.threadItemsByKey.has(threadKey)
      && !sidebarArchivePendingKeys.has(threadKey)
    ), [model.threadItemsByKey, pinnedStandaloneThreadKeys, sidebarArchivePendingKeys]);
  const fallbackPinnedStandaloneThreadKeys = useMemo(() =>
    pinnedStandaloneThreadKeys.filter((threadKey) =>
      !model.threadItemsByKey.has(threadKey)
      && !sidebarArchivePendingKeys.has(threadKey)
    ), [model.threadItemsByKey, pinnedStandaloneThreadKeys, sidebarArchivePendingKeys]);
  const reorderVisiblePinnedThreads = useCallback(async ({
    visibleThreadKeys,
    nextVisibleThreadKeys,
  }: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => {
    const mutation = buildCodexSidebarPinnedReorderMutation({
      pinnedThreadIds: model.snapshot.pinnedThreadIds,
      visibleThreadKeys,
      nextVisibleThreadKeys,
      itemsByKey: sidebarThreadItemsByKey,
    });
    const pendingItemsById = new Map(nextVisibleThreadKeys.flatMap((threadKey) => {
      const item = sidebarThreadItemsByKey.get(threadKey);
      return item?.pendingWorktreeId ? [[item.pendingWorktreeId, item] as const] : [];
    }));
    const pendingRequests = mutation.pendingUpdates.flatMap((update) => {
      const pendingItem = pendingItemsById.get(update.pendingWorktreeId);
      if (!pendingItem) return [];
      return [invoke(
        "codex:pending-worktree:set-pinned-before-thread",
        pendingItem.hostId,
        update.pendingWorktreeId,
        update.beforeThreadId,
      ).catch(() => {
        toast.danger("Failed to reorder pending chat");
      })];
    });

    try {
      const pinnedOrderRequest = onReorderPinnedThreads(mutation.pinnedThreadIds)
        .then(() => undefined);
      await Promise.all([pinnedOrderRequest, ...pendingRequests]);
    } catch (error) {
      toast.danger("Failed to reorder pinned chats");
      throw error;
    }
  }, [model.snapshot.pinnedThreadIds, onReorderPinnedThreads, sidebarThreadItemsByKey]);
  const canonicalUnpinnedThreadKeys = useMemo(() => sortSidebarThreadKeysForDisplay({
    threadKeys: [
      ...model.snapshot.items
        .filter((item) => !item.pinned && !sidebarArchivePendingKeys.has(item.key))
        .map((item) => item.key),
      ...fallbackThreadItems
        .filter((item) => !item.pinned && !sidebarArchivePendingKeys.has(item.key))
        .map((item) => item.key),
    ],
    itemsByKey: sidebarThreadItemsByKey,
    sessionsById,
  }), [
    fallbackThreadItems,
    model.snapshot.items,
    sessionsById,
    sidebarArchivePendingKeys,
    sidebarThreadItemsByKey,
  ]);
  const projectGroups = useMemo(() => model.projectGroups.map((group) => {
    const projectPinnedThreadKeySet = new Set([
      ...group.pinnedThreadKeys,
      ...fallbackThreadItems
        .filter((item) => item.projectId === group.project.id && item.pinned)
        .map((item) => item.key),
    ]);
    const pinnedThreadKeys = allPinnedThreadKeys.filter((threadKey) => (
      projectPinnedThreadKeySet.has(threadKey)
    ));
    const unpinnedThreadKeys = sortSidebarThreadKeysForDisplay({
      threadKeys: [
        ...group.threadKeys,
        ...fallbackThreadItems
          .filter((item) => item.projectId === group.project.id && !item.pinned)
          .map((item) => item.key),
      ],
      itemsByKey: sidebarThreadItemsByKey,
      sessionsById,
    });
    const manualThreadOrder = model.snapshot.projectThreadOrders[group.project.id];
    const threadKeys = manualThreadOrder
      ? orderCodexSidebarThreadKeysByManualThreadIds({
          threadKeys: unpinnedThreadKeys,
          orderedThreadIds: manualThreadOrder,
          getThreadId: getSidebarRealThreadId,
        })
      : unpinnedThreadKeys;
    return {
      project: group.project,
      pinnedThreadKeys,
      threadKeys,
    };
  }), [
    allPinnedThreadKeys,
    fallbackThreadItems,
    getSidebarRealThreadId,
    model.projectGroups,
    model.snapshot.projectThreadOrders,
    sessionsById,
    sidebarThreadItemsByKey,
  ]);
  const stableWorktreeWorkspaceRootOptions = useMemo(
    () => projectGroups.flatMap(({ project }) =>
      project.sources.map((source) => source.root)
    ),
    [projectGroups],
  );
  const stableWorktreeWorkspaceRootLabels = useMemo(() => Object.fromEntries(
    projectGroups.flatMap(({ project }) =>
      project.sources.map((source) => [source.root, project.name] as const)
    ),
  ), [projectGroups]);
  const projectLabelById = useMemo(() => {
    const entries = projectGroups.map(({ project }) => [project.id, project.name] as const);
    return new Map(entries);
  }, [projectGroups]);
  const projectOrderIds = useMemo(
    () => projectGroups.map((group) => group.project.id),
    [projectGroups],
  );
  const projectActivityQuery = useQuery(
    projectActivitySummariesQueryOptions(projectOrderIds),
  );
  const projectActivityById = useMemo(
    () => new Map(
      (projectActivityQuery.data?.summaries ?? []).map(
        (summary) => [summary.projectId, summary] as const,
      ),
    ),
    [projectActivityQuery.data?.summaries],
  );
  const pinnedProjectGroups = useMemo(
    () => projectGroups
      .filter((group) => group.project.pinned)
      .sort((left, right) =>
        (left.project.pinnedOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.project.pinnedOrder ?? Number.MAX_SAFE_INTEGER)
      ),
    [projectGroups],
  );
  const pinnedProjectIds = useMemo(
    () => pinnedProjectGroups.map((group) => group.project.id),
    [pinnedProjectGroups],
  );
  const unpinnedProjectGroups = useMemo(
    () => projectGroups.filter((group) => !group.project.pinned),
    [projectGroups],
  );
  const visibleProjectGroupIds = useMemo(
    () => unpinnedProjectGroups.map((group) => group.project.id),
    [unpinnedProjectGroups],
  );
  const projectGroupCollapseAction = useMemo(() => resolveSidebarProjectGroupCollapseAction({
    visibleGroupIds: visibleProjectGroupIds,
    expandedGroupIds: expandedProjectIds,
    previouslyExpandedGroupIds: previouslyExpandedProjectGroupIds,
  }), [expandedProjectIds, previouslyExpandedProjectGroupIds, visibleProjectGroupIds]);
  const runProjectGroupCollapseAction = useCallback((action: SidebarProjectGroupCollapseAction) => {
    if (action === "collapse-all") {
      const expandedVisibleProjectGroupIds = listExpandedVisibleProjectGroupIds(
        visibleProjectGroupIds,
        expandedProjectIds,
      );
      if (expandedVisibleProjectGroupIds.length === 0) return;

      setPreviouslyExpandedProjectGroupIds(expandedVisibleProjectGroupIds);
      for (const projectId of expandedVisibleProjectGroupIds) {
        onToggleProjectExpanded(projectId);
      }
      return;
    }

    const reopenableProjectGroupIds = listReopenableVisibleProjectGroupIds(
      visibleProjectGroupIds,
      previouslyExpandedProjectGroupIds,
    ).filter((projectId) => !expandedProjectIds.has(projectId));
    setPreviouslyExpandedProjectGroupIds([]);
    for (const projectId of reopenableProjectGroupIds) {
      onToggleProjectExpanded(projectId);
    }
  }, [
    expandedProjectIds,
    onToggleProjectExpanded,
    previouslyExpandedProjectGroupIds,
    visibleProjectGroupIds,
  ]);
  const reorderVisibleProjectGroups = useCallback((
    visibleGroupIds: string[],
    nextVisibleGroupIds: string[],
  ) => {
    const orderedProjectIds = replaceVisibleOrder(
      projectOrderIds,
      visibleGroupIds,
      nextVisibleGroupIds,
    );
    return onReorderProjects({ orderedProjectIds }).then(() => undefined);
  }, [onReorderProjects, projectOrderIds]);
  const reorderVisiblePinnedProjectGroups = useCallback((
    visibleGroupIds: string[],
    nextVisibleGroupIds: string[],
  ) => {
    const orderedProjectIds = replaceVisibleOrder(
      pinnedProjectIds,
      visibleGroupIds,
      nextVisibleGroupIds,
    );
    return onSetPinnedProjectOrder({ orderedProjectIds }).then(() => undefined);
  }, [onSetPinnedProjectOrder, pinnedProjectIds]);
  const hasVisiblePinnedStandaloneThreads = pinnedStandaloneThreadKeys.some((threadKey) =>
    !sidebarArchivePendingKeys.has(threadKey)
  );
  const hasVisiblePinnedSectionItems = hasVisiblePinnedStandaloneThreads || pinnedProjectGroups.length > 0;
  const projectlessThreadKeys = useMemo(() => {
    const canonicalProjectlessThreadKeys = canonicalUnpinnedThreadKeys.filter((threadKey) => (
      sidebarThreadItemsByKey.get(threadKey)?.projectless === true
    ));
    const manualThreadOrder = model.snapshot.projectlessThreadOrder;
    if (manualThreadOrder === null) return canonicalProjectlessThreadKeys;
    return orderCodexSidebarThreadKeysByManualThreadIds({
      threadKeys: canonicalProjectlessThreadKeys,
      orderedThreadIds: manualThreadOrder,
      getThreadId: getSidebarRealThreadId,
    });
  }, [
    canonicalUnpinnedThreadKeys,
    getSidebarRealThreadId,
    model.snapshot.projectlessThreadOrder,
    sidebarThreadItemsByKey,
  ]);
  const reorderVisibleProjectlessThreads = useCallback(async ({
    visibleThreadKeys,
    nextVisibleThreadKeys,
  }: {
    visibleThreadKeys: string[];
    nextVisibleThreadKeys: string[];
  }) => {
    const listRealThreadIds = (threadKeys: readonly string[]) => threadKeys.flatMap((threadKey) => {
      const threadId = getSidebarRealThreadId(threadKey);
      return threadId === null ? [] : [threadId];
    });
    const visibleThreadIds = listRealThreadIds(visibleThreadKeys);
    const nextVisibleThreadIds = listRealThreadIds(nextVisibleThreadKeys);
    if (
      visibleThreadIds.length !== visibleThreadKeys.length
      || nextVisibleThreadIds.length !== nextVisibleThreadKeys.length
    ) return;
    await onReorderChatsThreads({
      threadIdsInDisplayOrder: listRealThreadIds(projectlessThreadKeys),
      visibleThreadIds,
      nextVisibleThreadIds,
    });
  }, [
    getSidebarRealThreadId,
    onReorderChatsThreads,
    projectlessThreadKeys,
  ]);
  const activeThreadKey = useMemo(() => {
    if (activePendingClientThreadId) {
      for (const [key, item] of sidebarThreadItemsByKey) {
        if ((item.clientThreadId ?? item.threadId) === activePendingClientThreadId) return key;
      }
    }
    if (!activeSessionId) return null;
    const activeSession = sessionsById.get(activeSessionId);

    for (const [key, item] of sidebarThreadItemsByKey) {
      if (item.sessionId === activeSessionId) return key;
      if (activeSession?.thread && item.threadId === activeSession.thread.threadId) return key;
    }

    return activeSession ? `local:session:${activeSession.id}` : null;
  }, [activePendingClientThreadId, activeSessionId, sessionsById, sidebarThreadItemsByKey]);

  const setProjectThreadListExpanded = useCallback((projectId: string, expanded: boolean) => {
    setExpandedProjectThreadListIds((current) => {
      const next = new Set(current);
      if (expanded) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }
      return next;
    });
  }, []);

  const resolveSessionForItem = useCallback((item: CodexSidebarThreadItem) => {
    if (item.sessionId) {
      const session = sessionsById.get(item.sessionId);
      if (session) return session;
    }
    return sessionsByThreadId.get(item.threadId) ?? null;
  }, [sessionsById, sessionsByThreadId]);

  const renderThreadRow = useCallback((
    threadKey: string,
    options: {
      hoverCardProjectLabel?: string | null;
    } = {},
  ) => {
    const item = sidebarThreadItemsByKey.get(threadKey);
    if (!item) return null;
    const session = resolveSessionForItem(item);
    const sessionId = item.sessionId ?? session?.id ?? null;
    const hoverCardProjectLabel = options.hoverCardProjectLabel
      ?? (item.projectId ? projectLabelById.get(item.projectId) ?? null : null);

    return (
      <CodexSidebarThreadRow
        key={item.key}
        item={item}
        active={(item.clientThreadId ?? item.threadId) === activePendingClientThreadId
          || Boolean(sessionId && activeSessionId === sessionId)}
        contextMenuOpen={Boolean(sessionId && contextMenuSessionId === sessionId)}
        hoverCardProjectLabel={hoverCardProjectLabel}
        onHoverCardOpenChange={(open) => {
          setSidebarHoverSurfaceOpen(`thread:${item.key}`, open);
        }}
        onSelect={() => {
          void onSelectSidebarThread(item);
        }}
        onPreview={() => onPreviewSidebarThread?.(item)}
        onOpenContextMenu={session && onOpenSessionContextMenu
          ? (_item, event) => onOpenSessionContextMenu(session, event)
          : undefined}
        onRenameFromTitleDoubleClick={session && onSessionTitleDoubleClick
          ? (_item, event) => onSessionTitleDoubleClick(session, event)
          : item.kind === "pending-worktree" && onPendingWorktreeTitleDoubleClick
            ? (_item, event) => onPendingWorktreeTitleDoubleClick(item, event)
            : undefined}
        archivePending={sidebarArchivePendingKeys.has(item.key)}
        onArchive={onArchiveSidebarThread}
        onTogglePinned={session && onToggleSessionPinned
          ? () => onToggleSessionPinned(session)
          : onToggleSidebarThreadPinned}
      />
    );
  }, [
    activeSessionId,
    activePendingClientThreadId,
    contextMenuSessionId,
    onOpenSessionContextMenu,
    onArchiveSidebarThread,
    onSelectSidebarThread,
    onPreviewSidebarThread,
    onSessionTitleDoubleClick,
    onPendingWorktreeTitleDoubleClick,
    onToggleSessionPinned,
    onToggleSidebarThreadPinned,
    projectLabelById,
    resolveSessionForItem,
    setSidebarHoverSurfaceOpen,
    sidebarArchivePendingKeys,
    sidebarThreadItemsByKey,
  ]);

  const renderThreadList = useCallback((
    threadKeys: string[],
    emptyText: string,
    options: {
      ariaLabel?: string;
      maxItems?: number | null;
      expanded?: boolean;
      onExpandedChange?: (expanded: boolean) => void;
      forcedVisibleKey?: string | null;
    } = {},
  ) => (
    <CodexSidebarPaginatedItems
      items={threadKeys}
      getKey={(threadKey) => threadKey}
      maxItems={options.maxItems}
      expanded={options.expanded ?? false}
      onExpandedChange={options.onExpandedChange}
      forcedVisibleKey={options.forcedVisibleKey ?? null}
      suppressedKeys={sidebarArchivePendingKeys}
    >
      {(pagination, pager) => (
        <div className="isolate flex flex-col [contain:layout]">
          <div className="flex flex-col" role="list" aria-label={options.ariaLabel}>
            {pagination.visibleItems.length > 0 ? pagination.visibleItems.map((threadKey) => renderThreadRow(threadKey)) : (
              <div className="px-row-x py-row-y text-sm text-token-description-foreground" role="listitem">
                {emptyText}
              </div>
            )}
            {pager}
          </div>
        </div>
      )}
    </CodexSidebarPaginatedItems>
  ), [renderThreadRow, sidebarArchivePendingKeys]);

  const renderProjectGroupRows = (
    groups: typeof projectGroups,
    options: {
      reorderScope: "projects" | "pinned";
      expanded: boolean;
      onExpandedChange: (expanded: boolean) => void;
      emptyText?: string;
      readsProjectWindow?: boolean;
    },
  ) => (
    <CodexSidebarPaginatedItems
      items={groups}
      getKey={(group) => group.project.id}
      maxItems={CODEX_SIDEBAR_PROJECT_GROUP_MAX_GROUPS}
      expanded={options.expanded}
      onExpandedChange={options.onExpandedChange}
      forcedVisibleKey={activeProjectId}
      hasMoreAtSource={options.readsProjectWindow === true && hasMoreProjects}
      onLoadMore={options.readsProjectWindow ? onLoadMoreProjects : undefined}
    >
      {(pagination, pager) => {
        const visibleGroupIds = pagination.visibleItems.map((group) => group.project.id);
        return (
          <SidebarProjectGroupRowsContent
            visibleItems={pagination.visibleItems}
            pager={pager}
            emptyText={options.emptyText ?? "No projects"}
            loading={loadingMoreProjects}
            reorderGroups={(nextVisibleGroupIds) => {
              if (options.reorderScope === "pinned") {
                return reorderVisiblePinnedProjectGroups(visibleGroupIds, nextVisibleGroupIds);
              }
              return reorderVisibleProjectGroups(visibleGroupIds, nextVisibleGroupIds);
            }}
            renderProjectGroup={({
              project,
              pinnedThreadKeys,
              threadKeys,
            }, groupDndController) => {
              const expanded = expandedProjectIds.has(project.id);
              const threadListExpanded = expandedProjectThreadListIds.has(project.id);
              const projectThreadItems = Array.from(new Set([...pinnedThreadKeys, ...threadKeys]))
                .map((threadKey) => sidebarThreadItemsByKey.get(threadKey))
                .filter((item): item is CodexSidebarThreadItem => item != null);
              return (
                <CodexProjectRow
                  key={project.id}
                  project={project}
                  activity={projectActivityQuery.isPending
                    ? undefined
                    : projectActivityQuery.isError
                      ? null
                      : projectActivityById.get(project.id) ?? null}
                  active={activeSessionId === null && activeProjectId === project.id}
                  expanded={expanded}
                  groupDndController={groupDndController}
                  allowProjectReorder
                  threadItems={projectThreadItems}
                  onActivate={() => onToggleProjectExpanded(project.id)}
                  onSelectProject={() => onSelectProject(project.id)}
                  onStartNewChat={() => void onStartNewChatInProject(project.id)}
                  onUpdateProject={onUpdateProject}
                  onArchiveProject={onArchiveProject}
                  onSetProjectPinned={onSetProjectPinned}
                  onCreateStableWorktree={onCreateStableWorktree}
                  stableWorktreeWorkspaceRootOptions={stableWorktreeWorkspaceRootOptions}
                  stableWorktreeWorkspaceRootLabels={stableWorktreeWorkspaceRootLabels}
                  onArchiveThreadItem={onArchiveThreadItem}
                  onMarkThreadItemRead={onMarkThreadItemRead}
                  onThreadsChanged={onThreadsChanged}
                  onHoverCardOpenChange={(open) => {
                    setSidebarHoverSurfaceOpen(`project:${project.id}`, open);
                  }}
                >
                  <SidebarProjectThreadRowsContent
                    project={project}
                    pinnedThreadKeys={pinnedThreadKeys}
                    sortablePinnedThreadKeys={pinnedThreadKeys.filter((threadKey) => (
                      model.threadItemsByKey.has(threadKey)
                      && !sidebarArchivePendingKeys.has(threadKey)
                    ))}
                    threadKeys={threadKeys}
                    expanded={threadListExpanded}
                    onExpandedChange={(nextExpanded) => {
                      setProjectThreadListExpanded(project.id, nextExpanded);
                    }}
                    forcedVisibleKey={activeThreadKey}
                    suppressedKeys={sidebarArchivePendingKeys}
                    collectionState={
                      sessionCollectionsByProject[project.id]?.state
                      ?? IDLE_SESSION_COLLECTION_STATE
                    }
                    hasMoreAtSource={
                      sessionCollectionsByProject[project.id]?.hasMore === true
                    }
                    onLoadMore={() => onLoadMoreTaskWindow(project.id)}
                    onRetry={() => onRetryTaskWindow(project.id)}
                    onPinnedThreadOrderChange={reorderVisiblePinnedThreads}
                    onProjectThreadOrderChange={onReorderProjectThreads}
                    getThreadId={getSidebarRealThreadId}
                    itemsByKey={sidebarThreadItemsByKey}
                    renderThread={(threadKey) => renderThreadRow(threadKey, {
                      hoverCardProjectLabel: project.name,
                    })}
                  />
                </CodexProjectRow>
              );
            }}
          />
        );
      }}
    </CodexSidebarPaginatedItems>
  );

  const renderPinnedSection = () => {
    if (
      !hasVisiblePinnedSectionItems
      && !pinnedDropTarget.projectDragActive
      && !pinnedDropTarget.isExternalThreadDropTarget
    ) {
      return null;
    }

    if (!hasVisiblePinnedSectionItems) {
      return (
        <div
          ref={pinnedDropTarget.setNodeRef}
          className={cn(
            "-my-4 px-row-x",
            pinnedDropTarget.projectDragActive
              && pinnedDropTarget.isOver
              && "rounded-[10px] bg-token-bg-secondary/40 ring-1 ring-inset ring-token-border",
            pinnedDropTarget.isExternalThreadDropTarget
              && pinnedDropTarget.isOver
              && "rounded-[10px] bg-token-bg-secondary/40",
          )}
        >
          <div className="h-4">
            {pinnedDropTarget.projectDragActive && pinnedDropTarget.isOver
              ? <SidebarDropIndicator compensateLayout={false} />
              : null}
          </div>
        </div>
      );
    }

    return (
      <div
        ref={pinnedDropTarget.setNodeRef}
        className={cn(
          "relative",
          pinnedDropTarget.isExternalThreadDropTarget
            && pinnedDropTarget.isOver
            && "rounded-lg bg-token-list-hover-background",
        )}
      >
        <CodexSidebarSection
          heading="Pinned"
          collapsed={pinnedThreadsSectionCollapsed}
          onToggle={onTogglePinnedThreadsSectionCollapsed}
        >
          {sortablePinnedStandaloneThreadKeys.length > 0 ? (
            <SidebarPinnedThreadRowsContent
              containerId="pinned"
              getThreadId={getSidebarRealThreadId}
              visibleThreadKeys={sortablePinnedStandaloneThreadKeys}
              itemsByKey={sidebarThreadItemsByKey}
              ariaLabel="Pinned chats"
              onVisibleThreadOrderChange={reorderVisiblePinnedThreads}
              renderThread={renderThreadRow}
            />
          ) : null}
          {fallbackPinnedStandaloneThreadKeys.length > 0
            ? renderThreadList(fallbackPinnedStandaloneThreadKeys, "No pinned chats", {
                ariaLabel: "Pinned local views",
              })
            : null}
          {pinnedProjectGroups.length > 0
            ? renderProjectGroupRows(pinnedProjectGroups, {
              reorderScope: "pinned",
              expanded: pinnedProjectsExpanded,
              onExpandedChange: setPinnedProjectsExpanded,
            })
            : null}
        </CodexSidebarSection>
      </div>
    );
  };

  const renderProjectGroups = () => (
    <>
      {renderPinnedSection()}
      {libraryWorkspaceEnabled ? (
        <SidebarLibrarySection
          collapsed={librarySectionCollapsed}
          activeTarget={activeLibraryTarget}
          onToggle={onToggleLibrarySectionCollapsed}
          onOpenLibrary={onOpenLibrary}
          onOpenTarget={onOpenLibraryTarget}
          projects={projectGroups.map(({ project }) => ({
            id: project.id,
            name: project.name,
          }))}
          onOpenInProject={onOpenLibraryTargetInProject}
        />
      ) : null}
      <CodexSidebarSection
        heading="Projects"
        collapsed={projectsSectionCollapsed}
        onToggle={onToggleProjectsSectionCollapsed}
        actions={(
          <SidebarProjectsSectionActions
            projectGroupCollapseAction={projectGroupCollapseAction}
            onProjectGroupCollapseAction={runProjectGroupCollapseAction}
            onCreateProject={onCreateProject}
            openCreateDialogTick={projectPickerOpenTick}
          />
        )}
      >
        <StableWorktreeSidebarRows
          entries={pendingStableWorktrees}
          onOpen={onOpenStableWorktree}
        />
        {renderProjectGroupRows(unpinnedProjectGroups, {
          reorderScope: "projects",
          expanded: projectsExpanded,
          onExpandedChange: setProjectsExpanded,
          readsProjectWindow: true,
        })}
      </CodexSidebarSection>
      <CodexSidebarSection
        heading="Chats"
        collapsed={chatsSectionCollapsed}
        onToggle={onToggleChatsSectionCollapsed}
        actions={(
          <CodexSidebarActionButton
            label="New projectless chat"
            data-app-action-sidebar-projectless-new-chat=""
            onClick={() => void onStartNewChatInProject(null)}
          >
            <CodexNewChatIcon />
          </CodexSidebarActionButton>
        )}
      >
        <SidebarThreadContainerRowsContent
          containerId="chats"
          threadKeys={projectlessThreadKeys}
          getThreadId={getSidebarRealThreadId}
          itemsByKey={sidebarThreadItemsByKey}
          expanded={projectlessThreadListExpanded}
          onExpandedChange={setProjectlessThreadListExpanded}
          forcedVisibleKey={activeThreadKey}
          suppressedKeys={sidebarArchivePendingKeys}
          collectionState={projectlessSessionCollection.state}
          hasMoreAtSource={projectlessSessionCollection.hasMore}
          onLoadMore={() => onLoadMoreTaskWindow(null)}
          onRetry={() => onRetryTaskWindow(null)}
          onVisibleThreadOrderChange={reorderVisibleProjectlessThreads}
          renderThread={renderThreadRow}
        />
      </CodexSidebarSection>
    </>
  );

  return renderProjectGroups();
}

export interface ProjectSessionSidebarProps {
  libraryWorkspaceEnabled: boolean;
  floating?: boolean;
  header?: ReactNode;
  activeProjectId: string | null;
  activeSessionId: string | null;
  activePendingClientThreadId?: string | null;
  contextMenuSessionId?: string | null;
  sessionCollectionsByProject: Readonly<
    Record<string, WorkbenchSessionCollection>
  >;
  projectlessSessionCollection: WorkbenchSessionCollection;
  sidebarThreadModel: CodexSidebarThreadSyncModel;
  pendingStableWorktrees: readonly StableWorktreeEntry[];
  expandedProjectIds: Set<string>;
  pinnedProjectsSectionCollapsed: boolean;
  librarySectionCollapsed: boolean;
  projectsSectionCollapsed: boolean;
  chatsSectionCollapsed: boolean;
  onLoadMoreTaskWindow: (projectId: string | null) => Promise<void>;
  onRetryTaskWindow: (projectId: string | null) => Promise<void>;
  width: number;
  animatedWidth?: MotionValue<number>;
  contentOpacity?: MotionValue<number>;
  resizeDisabled?: boolean;
  getWindowZoom?: () => number;
  onResizeWidth: (width: number, phase?: SidebarResizePhase, surface?: SidebarResizeSurface) => void;
  onResizeActiveChange?: (active: boolean) => void;
  onHoverSurfaceOpenChange?: (open: boolean) => void;
  onTogglePinnedProjectsSectionCollapsed: () => void;
  onToggleLibrarySectionCollapsed: () => void;
  onToggleProjectsSectionCollapsed: () => void;
  onToggleChatsSectionCollapsed: () => void;
  onToggleProjectExpanded: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSidebarThread: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onPreviewSidebarThread?: (item: CodexSidebarThreadItem) => void;
  onOpenSessionContextMenu?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onSessionTitleDoubleClick?: (session: ProjectSession, event: ReactMouseEvent<HTMLElement>) => void;
  onPendingWorktreeTitleDoubleClick?: (
    item: CodexSidebarThreadItem,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onArchiveSidebarThread?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onArchiveThreadItem?: (item: CodexSidebarThreadItem) => Promise<boolean>;
  onMarkThreadItemRead?: (item: CodexSidebarThreadItem) => Promise<void>;
  onThreadsChanged?: () => Promise<unknown> | void;
  onToggleSessionPinned?: (session: ProjectSession) => void | Promise<void>;
  onToggleSidebarThreadPinned?: (item: CodexSidebarThreadItem) => void | Promise<void>;
  onStartNewChatInProject: (projectId: string | null) => void | Promise<void>;
  onOpenStableWorktree: (pendingWorktreeId: string) => void;
  onCreateStableWorktree: (project: Project, projectName: string) => Promise<void>;
  onOpenCommandPalette: () => void;
  onShowUnavailableProduct: (label: string) => void;
  onOpenAutomations: () => void;
  onOpenLibrary: () => void;
  onOpenLibraryTarget: (target: LibraryRouteTarget) => void;
  onOpenLibraryTargetInProject?: (
    projectId: string,
    target: LibraryResourceTarget,
    title: string,
  ) => void | Promise<void>;
  activeLibraryTarget: LibraryRouteTarget | null;
  automationsActive: boolean;
  projectPickerOpenTick?: number;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onArchiveProject: (projectId: string) => Promise<ProjectLifecycleMutationResult>;
  onReorderProjects: (input: ProjectOrderInput) => Promise<void>;
  onSetProjectPinned: (projectId: string, input: ProjectPinnedInput) => Promise<Project | null>;
  onSetPinnedProjectOrder: (input: ProjectPinnedOrderInput) => Promise<void>;
  onReorderProjectThreads: (projectId: string, orderedThreadIds: string[]) => Promise<void>;
  onReorderChatsThreads: (input: CodexSidebarChatsThreadOrderInput) => Promise<void>;
  onMoveSidebarThread: (drop: SidebarThreadDropRequest) => Promise<void>;
  onReorderPinnedThreads: (orderedThreadIds: readonly string[]) => Promise<unknown>;
  onOpenSettings: () => void;
  account: CodexAccountSnapshot | null;
  connection: CodexConnectionState;
  onRefreshAccount: () => Promise<CodexAccountSnapshot>;
  onConsumeRateLimitReset: ReturnType<typeof useCodexAccountActions>["consumeRateLimitReset"];
  onStartChatGptLogin: ReturnType<typeof useCodexAccountActions>["startChatGptLogin"];
  onStartApiKeyLogin: ReturnType<typeof useCodexAccountActions>["startApiKeyLogin"];
  onCancelLogin: ReturnType<typeof useCodexAccountActions>["cancelLogin"];
  onLogout: () => Promise<void>;
  onAccountErrorMessage: (message: string | null) => void;
  sidebarArchivePendingKeys: ReadonlySet<string>;
  hasMoreProjects: boolean;
  loadingMoreProjects: boolean;
  onLoadMoreProjects?: () => Promise<void>;
}

export function ProjectSessionSidebar({
  libraryWorkspaceEnabled,
  floating = false,
  header,
  activeProjectId,
  activeSessionId,
  activePendingClientThreadId,
  contextMenuSessionId,
  sessionCollectionsByProject,
  projectlessSessionCollection,
  sidebarThreadModel,
  pendingStableWorktrees,
  expandedProjectIds,
  pinnedProjectsSectionCollapsed,
  librarySectionCollapsed,
  projectsSectionCollapsed,
  chatsSectionCollapsed,
  onLoadMoreTaskWindow,
  onRetryTaskWindow,
  width,
  animatedWidth,
  contentOpacity,
  resizeDisabled = false,
  getWindowZoom,
  onResizeWidth,
  onResizeActiveChange,
  onHoverSurfaceOpenChange,
  onTogglePinnedProjectsSectionCollapsed,
  onToggleLibrarySectionCollapsed,
  onToggleProjectsSectionCollapsed,
  onToggleChatsSectionCollapsed,
  onToggleProjectExpanded,
  onSelectProject,
  onSelectSidebarThread,
  onPreviewSidebarThread,
  onOpenSessionContextMenu,
  onSessionTitleDoubleClick,
  onPendingWorktreeTitleDoubleClick,
  onArchiveSidebarThread,
  onArchiveThreadItem,
  onMarkThreadItemRead,
  onThreadsChanged,
  onToggleSessionPinned,
  onToggleSidebarThreadPinned,
  onStartNewChatInProject,
  onOpenStableWorktree,
  onCreateStableWorktree,
  onOpenCommandPalette,
  onShowUnavailableProduct,
  onOpenAutomations,
  onOpenLibrary,
  onOpenLibraryTarget,
  onOpenLibraryTargetInProject,
  activeLibraryTarget,
  automationsActive,
  projectPickerOpenTick = 0,
  onCreateProject,
  onUpdateProject,
  onArchiveProject,
  onReorderProjects,
  onSetProjectPinned,
  onSetPinnedProjectOrder,
  onReorderProjectThreads,
  onReorderChatsThreads,
  onMoveSidebarThread,
  onReorderPinnedThreads,
  onOpenSettings,
  account,
  connection,
  onRefreshAccount,
  onConsumeRateLimitReset,
  onStartChatGptLogin,
  onStartApiKeyLogin,
  onCancelLogin,
  onLogout,
  onAccountErrorMessage,
  sidebarArchivePendingKeys,
  hasMoreProjects,
  loadingMoreProjects,
  onLoadMoreProjects,
}: ProjectSessionSidebarProps) {
  const knownSessionProjections = useMemo(
    () => [
      ...Object.values(sessionCollectionsByProject).flatMap(
        (collection) => collection.projections,
      ),
      ...projectlessSessionCollection.projections,
    ],
    [projectlessSessionCollection.projections, sessionCollectionsByProject],
  );
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [pendingLibraryGrantDrop, setPendingLibraryGrantDrop] = useState<{
    readonly resource: SidebarLibraryDragResource;
    readonly projectId: string;
  } | null>(null);
  const [libraryGrantAccess, setLibraryGrantAccess] = useState<"read" | "read_write">("read_write");
  const { mutation: libraryMutation } = useApplyLibraryOperation(
    libraryWorkspaceEnabled,
  );
  const [scrolledContentUnderHeader, setScrolledContentUnderHeader] = useState(false);
  const sidebarResizeDisabled = resizeDisabled;
  const sidebarResizeSurface: SidebarResizeSurface = floating ? "floating" : "inline";
  const setSidebarResizeActive = (active: boolean) => {
    setSidebarResizing(active);
    onResizeActiveChange?.(active);
  };
  useEffect(() => () => {
    onHoverSurfaceOpenChange?.(false);
  }, [onHoverSurfaceOpenChange]);
  const handleProjectDrop = useCallback((drop: { projectId: string; targetContainerId: string }) => {
    if (drop.targetContainerId !== "pinned") return;
    void onSetProjectPinned(drop.projectId, { pinned: true }).catch(() => {
      toast.danger("Failed to pin project");
    });
  }, [onSetProjectPinned]);
  const handleLibraryMove = useCallback(async ({
    resource,
    parent,
  }: {
    resource: SidebarLibraryDragResource;
    parent: import("../../../shared/library-module").LibraryWriteParent;
  }) => {
    if (!libraryWorkspaceEnabled) return;
    try {
      await libraryMutation.mutateAsync(buildLibraryMoveOperation({
        target: resource.target,
        expectedLocationRevision: resource.expectedLocationRevision,
        parent,
      }));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not move Library item");
    }
  }, [libraryMutation, libraryWorkspaceEnabled]);
  const confirmLibraryGrantDrop = useCallback(async () => {
    if (!libraryWorkspaceEnabled) return;
    if (!pendingLibraryGrantDrop) return;
    const project = sidebarThreadModel.projectGroups.find(
      (group) => group.project.id === pendingLibraryGrantDrop.projectId,
    )?.project;
    if (!project) {
      toast.danger("The destination Project is no longer active");
      setPendingLibraryGrantDrop(null);
      return;
    }
    try {
      const receipt = await libraryMutation.mutateAsync(buildLibraryProjectGrantOperation({
        projectId: project.id,
        target: pendingLibraryGrantDrop.resource.target,
        access: libraryGrantAccess,
      }));
      if (!receipt.didMutate) toast.info(`${project.name} already has this access`);
      setPendingLibraryGrantDrop(null);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not grant Project access");
    }
  }, [
    libraryGrantAccess,
    libraryMutation,
    libraryWorkspaceEnabled,
    pendingLibraryGrantDrop,
    sidebarThreadModel.projectGroups,
  ]);
  const pendingLibraryGrantProject = pendingLibraryGrantDrop
    ? sidebarThreadModel.projectGroups.find(
        (group) => group.project.id === pendingLibraryGrantDrop.projectId,
      )?.project ?? null
    : null;
  const sidebarThreadIdByKey = useMemo(() => {
    const entries: Array<readonly [string, string]> = [];
    for (const [threadKey, item] of sidebarThreadModel.threadItemsByKey) {
      if (item.pendingWorktreeId) continue;
      entries.push([threadKey, item.threadId]);
    }
    for (const session of knownSessionProjections) {
      if (!session.thread) continue;
      entries.push([`local:session:${session.id}`, session.thread.threadId]);
    }
    return new Map(entries);
  }, [knownSessionProjections, sidebarThreadModel.threadItemsByKey]);
  const knownSidebarProjectIds = useMemo(
    () => new Set(sidebarThreadModel.projectGroups.map((group) => group.project.id)),
    [sidebarThreadModel.projectGroups],
  );
  const homeContainerIdByThreadId = useMemo(() => {
    const entries: Array<readonly [string, string]> = [];
    for (const item of sidebarThreadModel.threadItemsByKey.values()) {
      if (item.pendingWorktreeId) continue;
      const containerId = resolveCodexSidebarThreadHomeContainerId({
        kind: item.kind,
        pinned: item.pinned,
        projectId: item.projectId,
        projectless: item.projectless,
        knownProjectIds: knownSidebarProjectIds,
      });
      if (containerId) entries.push([item.threadId, containerId]);
    }
    for (const session of knownSessionProjections) {
      if (!session.thread) continue;
      const containerId = resolveCodexSidebarThreadHomeContainerId({
        kind: "local",
        pinned: session.pinned,
        projectId: session.projectId,
        projectless: session.projectId === null,
        knownProjectIds: knownSidebarProjectIds,
      });
      if (containerId === null) continue;
      entries.push([
        session.thread.threadId,
        containerId,
      ]);
    }
    return new Map(entries);
  }, [
    knownSidebarProjectIds,
    knownSessionProjections,
    sidebarThreadModel.threadItemsByKey,
  ]);
  const getSidebarThreadIdByKey = useCallback(
    (threadKey: string) => sidebarThreadIdByKey.get(threadKey) ?? null,
    [sidebarThreadIdByKey],
  );

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sidebarResizeDisabled) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const resolveZoom = getWindowZoom ?? (() => 1);
    const startX = event.clientX / resolveZoom();
    const startWidth = width;
    let didMove = false;

    setSidebarResizeActive(true);

    const resolveNextWidth = (nextEvent: PointerEvent) =>
      startWidth + ((nextEvent.clientX / resolveZoom()) - startX);

    function stopResize() {
      setSidebarResizeActive(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    }

    function onPointerMove(nextEvent: PointerEvent) {
      nextEvent.preventDefault();
      didMove = didMove || nextEvent.clientX / resolveZoom() !== startX;
      onResizeWidth(resolveNextWidth(nextEvent), "live", sidebarResizeSurface);
    }

    function onPointerUp(nextEvent: PointerEvent) {
      nextEvent.preventDefault();
      if (didMove) {
        onResizeWidth(resolveNextWidth(nextEvent), "end", sidebarResizeSurface);
      }
      stopResize();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleResizeClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (sidebarResizeDisabled) return;
    if (event.detail !== 2) return;
    event.preventDefault();
    setSidebarResizeActive(false);
    onResizeWidth(CODEX_SIDEBAR_WIDTH_DEFAULT_PX, "reset", sidebarResizeSurface);
  };

  const resizeHandle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-disabled={sidebarResizeDisabled || undefined}
      onClick={handleResizeClick}
      onPointerDown={handleResizePointerDown}
      data-testid="sidebar-resize-strip"
      className={cn(
        "group absolute flex touch-none select-none z-20 -top-toolbar right-0 bottom-0 w-4 translate-x-2",
        sidebarResizeDisabled ? "pointer-events-none" : "cursor-col-resize active:cursor-col-resize",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "sidebar-resize-handle-line pointer-events-none m-auto opacity-0",
          "h-full w-px bg-gradient-to-b from-transparent via-token-foreground/25 to-transparent",
          sidebarResizing ? "opacity-100" : "group-hover:opacity-100 group-active:opacity-100",
        )}
      />
    </div>
  );

  const sidebarShell = (
    <motion.aside
      className={cn(
        floating
          ? CODEX_SIDEBAR_FLOATING_ASIDE_CLASS
          : "app-shell-left-panel pointer-events-auto relative flex h-full min-h-0 shrink-0 flex-col overflow-visible browser:bg-token-main-surface-primary",
        sidebarResizing && "cursor-col-resize",
        "font-sans text-sm",
      )}
      style={{
        width: floating ? width : animatedWidth ?? width,
        ...(!floating ? { paddingTop: "var(--height-toolbar)" } : {}),
      }}
      data-testid={floating ? "app-shell-floating-left-panel" : "project-session-sidebar"}
    >
      {header}
      <motion.div
        className="max-w-full min-h-0 flex-1 overflow-hidden"
        style={{ minWidth: width, width, opacity: floating ? undefined : contentOpacity }}
      >
        <div
          className="flex h-full min-h-0 flex-col overflow-hidden [--height-token-nav-row:30px] [--padding-row-cell-x:8px] [--padding-row-x:8px] [--radius-token-row:10px]"
          style={getSidebarScrollChromeStyle(scrolledContentUnderHeader)}
        >
          <nav
            className="sidebar-foreground-muted flex min-h-0 flex-1 flex-col"
            role="navigation"
            aria-label="Automation folders"
          >
            <SidebarExpandedHeader
              productName="Nodex"
              searchShortcutLabel={resolveCodexPageSearchShortcutLabel()}
              newChatShortcutLabel={resolveCodexNewChatShortcutLabel()}
              scrolledContentUnderHeader={scrolledContentUnderHeader}
              onSearch={onOpenCommandPalette}
              onNewChat={() => void onStartNewChatInProject(activeProjectId)}
            />

            <div
              data-app-action-sidebar-scroll=""
              className={SIDEBAR_SCROLL_AREA_CLASS}
              onScroll={(event) => {
                setScrolledContentUnderHeader(event.currentTarget.scrollTop > 0);
              }}
            >
              <div className="flex shrink-0 flex-col gap-2" data-app-action-sidebar-scroll-top-actions="">
                <div className="shrink-0 px-row-x">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-col gap-px">
                      <CodexSidebarTopActionButton
                        label="Scheduled"
                        icon={<CodexAutomationsIcon />}
                        active={automationsActive}
                        onClick={() => onOpenAutomations()}
                      />
                      <CodexSidebarTopActionButton
                        label="Plugins"
                        icon={<ComposerPluginsIcon className="icon-xs" />}
                        onClick={() => onShowUnavailableProduct("Plugins")}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <SidebarReorderDndProvider
                getThreadIdByThreadKey={getSidebarThreadIdByKey}
                homeContainerIdByThreadId={homeContainerIdByThreadId}
                onProjectError={reportSidebarProjectReorderError}
                onProjectDrop={handleProjectDrop}
                onThreadError={reportSidebarThreadReorderError}
                onThreadDrop={onMoveSidebarThread}
                onLibraryMove={libraryWorkspaceEnabled ? handleLibraryMove : undefined}
                onLibraryGrant={libraryWorkspaceEnabled ? setPendingLibraryGrantDrop : undefined}
              >
                <SidebarThreadOrganizerSections
                  libraryWorkspaceEnabled={libraryWorkspaceEnabled}
                  activeProjectId={activeProjectId}
                  activeSessionId={activeSessionId}
                  activePendingClientThreadId={activePendingClientThreadId}
                  contextMenuSessionId={contextMenuSessionId}
                  sessionCollectionsByProject={sessionCollectionsByProject}
                  projectlessSessionCollection={projectlessSessionCollection}
                  expandedProjectIds={expandedProjectIds}
                  pinnedThreadsSectionCollapsed={pinnedProjectsSectionCollapsed}
                  librarySectionCollapsed={librarySectionCollapsed}
                  projectsSectionCollapsed={projectsSectionCollapsed}
                  chatsSectionCollapsed={chatsSectionCollapsed}
                  onLoadMoreTaskWindow={onLoadMoreTaskWindow}
                  onRetryTaskWindow={onRetryTaskWindow}
                  model={sidebarThreadModel}
                  onHoverSurfaceOpenChange={onHoverSurfaceOpenChange}
                  onTogglePinnedThreadsSectionCollapsed={onTogglePinnedProjectsSectionCollapsed}
                  onToggleLibrarySectionCollapsed={onToggleLibrarySectionCollapsed}
                  onToggleProjectsSectionCollapsed={onToggleProjectsSectionCollapsed}
                  onToggleChatsSectionCollapsed={onToggleChatsSectionCollapsed}
                  onToggleProjectExpanded={onToggleProjectExpanded}
                  onSelectProject={onSelectProject}
                  onSelectSidebarThread={onSelectSidebarThread}
                  onPreviewSidebarThread={onPreviewSidebarThread}
                  onOpenSessionContextMenu={onOpenSessionContextMenu}
                  onSessionTitleDoubleClick={onSessionTitleDoubleClick}
                  onPendingWorktreeTitleDoubleClick={onPendingWorktreeTitleDoubleClick}
                  onArchiveSidebarThread={onArchiveSidebarThread}
                  onArchiveThreadItem={onArchiveThreadItem}
                  onMarkThreadItemRead={onMarkThreadItemRead}
                  onThreadsChanged={onThreadsChanged}
                  onToggleSessionPinned={onToggleSessionPinned}
                  onToggleSidebarThreadPinned={onToggleSidebarThreadPinned}
                  onStartNewChatInProject={onStartNewChatInProject}
                  pendingStableWorktrees={pendingStableWorktrees}
                  onOpenStableWorktree={onOpenStableWorktree}
                  onCreateStableWorktree={onCreateStableWorktree}
                  projectPickerOpenTick={projectPickerOpenTick}
                  onCreateProject={onCreateProject}
                  onUpdateProject={onUpdateProject}
                  onArchiveProject={onArchiveProject}
                  onReorderProjects={onReorderProjects}
                  onSetProjectPinned={onSetProjectPinned}
                  onSetPinnedProjectOrder={onSetPinnedProjectOrder}
                  onReorderProjectThreads={onReorderProjectThreads}
                  onReorderChatsThreads={onReorderChatsThreads}
                  onReorderPinnedThreads={onReorderPinnedThreads}
                  sidebarArchivePendingKeys={sidebarArchivePendingKeys}
                  onOpenLibrary={onOpenLibrary}
                  onOpenLibraryTarget={onOpenLibraryTarget}
                  onOpenLibraryTargetInProject={onOpenLibraryTargetInProject}
                  activeLibraryTarget={activeLibraryTarget}
                  hasMoreProjects={hasMoreProjects}
                  loadingMoreProjects={loadingMoreProjects}
                  onLoadMoreProjects={onLoadMoreProjects}
                />
              </SidebarReorderDndProvider>
              {libraryWorkspaceEnabled ? (
                <NodexDialog
                  open={pendingLibraryGrantDrop !== null}
                  onOpenChange={(open) => {
                    if (!open) setPendingLibraryGrantDrop(null);
                  }}
                >
                  <NodexDialogContent size="compact">
                    <NodexDialogFrame>
                      <NodexDialogHeader>
                        <NodexDialogTitle>Give Project access?</NodexDialogTitle>
                        <NodexDialogDescription>
                          {pendingLibraryGrantProject?.name ?? "This Project"} will receive recursive access to {pendingLibraryGrantDrop?.resource.title ?? "this Library item"}. Ownership and Database bindings will not change.
                        </NodexDialogDescription>
                      </NodexDialogHeader>
                      <NodexDialogBody>
                        <fieldset className="grid gap-2 text-sm text-token-text-primary">
                          <legend className="mb-1">Access</legend>
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="library-drop-access"
                              checked={libraryGrantAccess === "read"}
                              onChange={() => setLibraryGrantAccess("read")}
                            />
                            Read
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="library-drop-access"
                              checked={libraryGrantAccess === "read_write"}
                              onChange={() => setLibraryGrantAccess("read_write")}
                            />
                            Read &amp; write
                          </label>
                        </fieldset>
                      </NodexDialogBody>
                      <NodexDialogFooter>
                        <NodexDialogAction onClick={() => setPendingLibraryGrantDrop(null)}>
                          Cancel
                        </NodexDialogAction>
                        <NodexDialogAction
                          tone="primary"
                          disabled={!pendingLibraryGrantProject || libraryMutation.isPending}
                          onClick={() => void confirmLibraryGrantDrop()}
                        >
                          Grant access
                        </NodexDialogAction>
                      </NodexDialogFooter>
                    </NodexDialogFrame>
                  </NodexDialogContent>
                </NodexDialog>
              ) : null}
            </div>

            <LeftSidebarFooter
              onOpenSettings={onOpenSettings}
              account={account}
              connection={connection}
              onRefreshAccount={onRefreshAccount}
              onConsumeRateLimitReset={onConsumeRateLimitReset}
              onStartChatGptLogin={onStartChatGptLogin}
              onStartApiKeyLogin={onStartApiKeyLogin}
              onCancelLogin={onCancelLogin}
              onLogout={onLogout}
              onErrorMessage={onAccountErrorMessage}
            />
          </nav>
        </div>
      </motion.div>

      {!floating ? resizeHandle : null}
    </motion.aside>
  );

  if (floating) {
    return (
      <>
        {sidebarShell}
        {resizeHandle}
      </>
    );
  }

  return sidebarShell;
}
