import { useState, useEffect, useCallback, useDeferredValue, useMemo, useRef } from "react";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { Column } from "./column";
import { type CardPropertyUpdateInput } from "./card";
import type { OpenPageStageOptions } from "./open-page-stage";
import {
  emptyCardSelection,
  normalizeCardSelection,
  toggleCardSelection,
  type CardSelectionState,
} from "./card-selection";
import { KanbanBoardScrollContainer } from "./view-scroll-containers";
import {
  groupScopeKeyForColumn,
  UNGROUPED_SCOPE_KEY,
} from "@/lib/kanban-store";
import { buildPageDeepLink } from "@/lib/page-deeplink";
import type {
  OpenPageInNewChatInput,
  SendPageToChatInput,
} from "@/lib/page-chat-actions";
import {
  getKanbanColumnLayout,
  readKanbanColumnLayoutPrefs,
  updateKanbanColumnLayoutPrefs,
  writeKanbanColumnLayoutPrefs,
  type KanbanColumnLayoutPrefs,
} from "@/lib/kanban-column-layout";
import { useKanban } from "@/lib/use-kanban";
import { useMutationAuditSessionId } from "@/lib/mutation-audit-session";
import { writeTextToClipboard } from "@/lib/clipboard";
import {
  filterDbViewCards,
  getDefaultDbViewPrefs,
  sortDbViewCards,
  type DbViewCardRecord,
  type DbViewPrefs,
} from "../../lib/db-view-prefs";
import type {
  DatabasePageSummary,
  WorkflowStatus,
  PageCreatePlacement,
  PageInput,
  Project,
} from "@/lib/types";
import { buildPageSearchText, matchesSearchTokens, tokenizeSearchQuery } from "@/lib/page-search";
import {
  buildKanbanCardDragData,
  isKanbanCardDragData,
  type KanbanCardDragData,
} from "./pragmatic-drag-data";
import { resolveKanbanDropLocation } from "./pragmatic-drop-location";
import {
  resolveKanbanCardDragMode,
  resolveKanbanCardDropIntent,
} from "./kanban-card-drop-strategy";
import { resolveKanbanDropCapabilities } from "./kanban-drop-capabilities";
import { resolveKanbanDropFeedback } from "./drop-feedback";
import { computeNativeDropIndexFromSurface } from "./native-drop-index";
import {
  blockTransferDropLabel,
  buildBlockToDataSourceTransferIntent,
  endLocalBlockDragSession,
  hasDragType,
  NODEX_BLOCK_TRANSFER_DRAG_MIME,
  resolveLocalBlockDragDropSession,
  resolveCrossSurfaceTransferMode,
  shouldHandleNativeCrossSurfaceDrag,
} from "./cross-surface-drag";
import { toast } from "@/components/ui/toast";
import { useKanbanElementDragMonitor } from "./use-kanban-element-drag-monitor";
import { transferBlocks } from "@/lib/api";

const KANBAN_CARD_PREVIEW_OPEN_DELAY_MS = 180;
type KanbanCardOpenMode = NonNullable<OpenPageStageOptions["openMode"]>;
type CardType = DatabasePageSummary;

function hasSameCardSelection(
  left: CardSelectionState,
  right: CardSelectionState,
): boolean {
  if (left.pageIds.size !== right.pageIds.size) return false;

  for (const pageId of left.pageIds) {
    if (!right.pageIds.has(pageId)) return false;
  }

  return true;
}

interface KanbanBoardProps {
  projectId: string;
  databaseViewId: string;
  projects: Project[];
  searchQuery: string;
  dbViewPrefs: DbViewPrefs | null;
  openPageStage: (
    projectId: string,
    pageId: string,
    titleSnapshot?: string,
    options?: OpenPageStageOptions,
  ) => void;
  onOpenPageInNewChat?: (input: OpenPageInNewChatInput) => Promise<void> | void;
  onSendPageToChat?: (input: SendPageToChatInput) => Promise<void> | void;
  pageStagePageId: string | undefined;
  activePanelPageStagePageIds?: ReadonlySet<string>;
  pageStageCloseRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  scrollStateKey?: string | null;
}

export function KanbanBoard({
  projectId,
  databaseViewId,
  projects,
  searchQuery,
  dbViewPrefs,
  openPageStage,
  onOpenPageInNewChat,
  onSendPageToChat,
  pageStagePageId,
  activePanelPageStagePageIds,
  pageStageCloseRef,
  scrollStateKey,
}: KanbanBoardProps) {
  const mutationAuditSessionId = useMutationAuditSessionId();
  const pendingCardPreviewOpenRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingCardPreviewOpen = useCallback(() => {
    if (pendingCardPreviewOpenRef.current === null) return;
    clearTimeout(pendingCardPreviewOpenRef.current);
    pendingCardPreviewOpenRef.current = null;
  }, []);

  useEffect(() => clearPendingCardPreviewOpen, [clearPendingCardPreviewOpen]);

  const {
    board,
    databaseView,
    loading,
    error,
    createPage,
    updatePage,
    deletePage,
    movePage,
    movePages,
    refresh,
    groupPagination,
    loadMoreGroup,
  } =
    useKanban({
      projectId,
      databaseViewId,
      sessionId: mutationAuditSessionId,
    });

  const [cardSelection, setCardSelection] = useState<CardSelectionState>(() => emptyCardSelection());
  const boardScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [dragInstanceId] = useState(() => Symbol("kanban-board-dnd"));

  const [dropIndicator, setDropIndicator] = useState<{
    columnId: string;
    index: number;
    label?: string;
  } | null>(null);
  const [activeDropColumnId, setActiveDropColumnId] = useState<string | null>(null);
  const [blockedDropMessage, setBlockedDropMessage] = useState<{
    columnId: string;
    message: string;
  } | null>(null);
  const [activeDraggedPageIds, setActiveDraggedPageIds] = useState<ReadonlySet<string>>(() => new Set());

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [columnLayoutPrefs, setColumnLayoutPrefs] = useState<KanbanColumnLayoutPrefs>(
    () => readKanbanColumnLayoutPrefs(projectId),
  );

  const searchTokens = useMemo(
    () => tokenizeSearchQuery(deferredSearchQuery),
    [deferredSearchQuery]
  );
  const viewPrefs = dbViewPrefs ?? getDefaultDbViewPrefs("kanban");
  const hasSearchFilter = searchTokens.length > 0;
  const dragMode = useMemo(
    () => resolveKanbanCardDragMode({ rules: viewPrefs.rules }),
    [viewPrefs.rules],
  );
  const dropCapabilities = useMemo(
    () => resolveKanbanDropCapabilities({ dragMode }),
    [dragMode],
  );

  const filteredBoard = useMemo(() => {
    if (!board) return null;

    return {
      ...board,
      columns: board.columns.map((column, columnIndex) => {
        const columnCards = column.cards.map<DbViewCardRecord>((card, pageIndex) => ({
          ...card,
          columnId: column.id,
          columnName: column.name,
          boardIndex: columnIndex * 100_000 + pageIndex,
        }));
        const filteredByRules = filterDbViewCards(columnCards, viewPrefs.rules);
        const filteredBySearch = hasSearchFilter
          ? filteredByRules.filter((card) =>
            matchesSearchTokens(
              `${buildPageSearchText(card)} ${card.columnName.toLowerCase()}`,
              searchTokens,
            ))
          : filteredByRules;

        return {
          ...column,
          cards: sortDbViewCards(filteredBySearch, viewPrefs.rules),
        };
      }),
    };
  }, [board, hasSearchFilter, searchTokens, viewPrefs.rules]);

  useEffect(() => {
    setCardSelection((current) => {
      const normalized = normalizeCardSelection(
        current,
        filteredBoard ?? board,
      );
      return hasSameCardSelection(current, normalized) ? current : normalized;
    });
  }, [board, filteredBoard]);

  useEffect(() => {
    setColumnLayoutPrefs(readKanbanColumnLayoutPrefs(projectId));
  }, [projectId]);

  const currentProjectName = useMemo(
    () => projects.find((project) => project.id === projectId)?.name ?? projectId,
    [projectId, projects],
  );

  const selectedPageIds = cardSelection.pageIds;

  const resolveColumnSurface = useCallback((columnId: string): HTMLElement | null => {
    if (typeof document === "undefined") return null;

    return document.querySelector<HTMLElement>(`[data-kanban-column-id="${columnId}"]`);
  }, []);

  const buildDragData = useCallback(
    (card: CardType, columnId: string): KanbanCardDragData => buildKanbanCardDragData({
      board: filteredBoard ?? board,
      selection: cardSelection,
      instanceId: dragInstanceId,
      projectId,
      activePage: card,
      databaseBlockId: databaseView?.databaseId ?? "unavailable",
      dataSourceId: databaseView?.dataSourceId ?? "unavailable",
      storeEpoch: databaseView?.storeEpoch ?? "unavailable",
      columnId: columnId as WorkflowStatus,
    }),
    [board, cardSelection, databaseView, dragInstanceId, filteredBoard, projectId],
  );

  const clearBoardCardDragState = useCallback(() => {
    setDropIndicator(null);
    setActiveDropColumnId(null);
    setBlockedDropMessage(null);
    setActiveDraggedPageIds(new Set());
  }, []);

  const handleExternalBlockDragOver = useCallback(
    (columnId: WorkflowStatus, event: React.DragEvent<HTMLDivElement>) => {
      if (!shouldHandleNativeCrossSurfaceDrag(event.dataTransfer)) return;
      const transfersBlocks = hasDragType(
        event.dataTransfer,
        NODEX_BLOCK_TRANSFER_DRAG_MIME,
      );
      if (!transfersBlocks) return;

      event.preventDefault();
      event.stopPropagation();
      const mode = resolveCrossSurfaceTransferMode(event);
      event.dataTransfer.dropEffect = mode;
      const index = computeNativeDropIndexFromSurface(
        event.currentTarget,
        event.clientY,
      );
      setActiveDropColumnId(columnId);
      const label = blockTransferDropLabel(mode, "data_source");
      setDropIndicator((current) =>
        current?.columnId === columnId &&
        current.index === index &&
        current.label === label
          ? current
          : { columnId, index, label },
      );
      setBlockedDropMessage(null);
    },
    [],
  );

  const handleExternalBlockDragLeave = useCallback(
    (columnId: WorkflowStatus, event: React.DragEvent<HTMLDivElement>) => {
      if (!shouldHandleNativeCrossSurfaceDrag(event.dataTransfer)) return;
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setActiveDropColumnId((current) =>
        current === columnId ? null : current,
      );
      setDropIndicator((current) =>
        current?.columnId === columnId ? null : current,
      );
    },
    [],
  );

  const handleExternalBlockDrop = useCallback(
    async (columnId: WorkflowStatus, event: React.DragEvent<HTMLDivElement>) => {
      const session = resolveLocalBlockDragDropSession(event.dataTransfer);
      if (!session) return;
      const authoritativePayload = session.payload;

      event.preventDefault();
      event.stopPropagation();
      endLocalBlockDragSession({ sessionId: session.sessionId });
      const destinationIndex = computeNativeDropIndexFromSurface(
        event.currentTarget,
        event.clientY,
      );
      setActiveDropColumnId(null);
      setDropIndicator(null);
      setBlockedDropMessage(null);

      if (
        !databaseView ||
        authoritativePayload.projectId !== projectId ||
        authoritativePayload.storeEpoch !== databaseView.storeEpoch
      ) {
        toast.danger("Block transfer belongs to another Project or store generation.");
        return;
      }
      const destinationCards = filteredBoard?.columns.find(
        (column) => column.id === columnId,
      )?.cards ?? [];
      const beforePageId = destinationCards[destinationIndex]?.id;
      const result = await transferBlocks(
        projectId,
        buildBlockToDataSourceTransferIntent({
          operationId: crypto.randomUUID(),
          projectId,
          storeEpoch: databaseView.storeEpoch,
          payload: authoritativePayload,
          dataSourceId: databaseView.dataSourceId,
          viewId: databaseView.databaseViewId,
          groupKey: columnId,
          ...(beforePageId ? { beforePageId } : {}),
          altKey: event.altKey,
        }),
      );
      if (!result.ok) {
        toast.danger(result.error.message);
        return;
      }
      await refresh();
    },
    [databaseView, filteredBoard, projectId, refresh],
  );

  const performCardDrop = useCallback(async (
    dragData: KanbanCardDragData,
    dropTargets: ReadonlyArray<{ data: Record<string | symbol, unknown> }>,
    pointer: { x: number; y: number } | null,
  ) => {
    const dragPageIds = dragData.dragItems.map((entry) => entry.card.id);
    const destination = resolveKanbanDropLocation({
      visibleBoard: filteredBoard,
      dropTargets,
      sourceData: dragData,
      draggedPageIds: dragPageIds,
      pointerY: pointer?.y ?? null,
      resolveColumnSurface,
    });
    if (!destination) {
      return;
    }

    const dropIntent = resolveKanbanCardDropIntent({
      board,
      visibleBoard: filteredBoard,
      rules: viewPrefs.rules,
      destinationColumnId: destination.columnId,
      destinationIndex: destination.index,
      dragItems: dragData.dragItems,
    });
    if (dropIntent.kind === "blocked") {
      return;
    }

    const sharedSourceColumnId = dragData.dragItems.every(
      (entry) => entry.columnId === dragData.dragItems[0]?.columnId,
    )
      ? (dragData.dragItems[0]?.columnId as WorkflowStatus | undefined)
      : undefined;
    const newOrder = dropIntent.kind === "reorder" || dropIntent.kind === "reorder-with-patch"
      ? dropIntent.newOrder
      : undefined;
    const fieldPatch = dropIntent.kind === "reorder-with-patch"
      ? dropIntent.fieldPatch
      : undefined;

    if (dragPageIds.length > 1) {
      const moved = await movePages({
        pageIds: dragPageIds,
        ...(sharedSourceColumnId ? { fromStatus: sharedSourceColumnId } : {}),
        toStatus: destination.columnId,
        ...(typeof newOrder === "number" ? { newOrder } : {}),
        ...(fieldPatch ? { fieldPatch } : {}),
      });
      if (!moved) return;

      setCardSelection({
        pageIds: new Set(dragPageIds),
      });
      return;
    }

    const moved = await movePage({
      pageId: dragData.sourcePageId,
      fromStatus: dragData.sourceColumnId,
      toStatus: destination.columnId,
      ...(typeof newOrder === "number" ? { newOrder } : {}),
      ...(fieldPatch ? { fieldPatch } : {}),
    });
    if (!moved) return;

    setCardSelection(emptyCardSelection());
  }, [
    board,
    filteredBoard,
    movePage,
    movePages,
    resolveColumnSurface,
    viewPrefs.rules,
  ]);

  useEffect(() => {
    const element = boardScrollContainerRef.current;
    if (!element) {
      return;
    }

    return autoScrollForElements({
      element,
      canScroll: ({ source }) => isKanbanCardDragData(source.data)
        && source.data.instanceId === dragInstanceId,
    });
  }, [dragInstanceId]);

  useKanbanElementDragMonitor({
    scopeKey: dragInstanceId,
    canMonitor: ({ source }) => isKanbanCardDragData(source.data)
      && source.data.instanceId === dragInstanceId,
    onDragStart: ({ source }) => {
        if (!isKanbanCardDragData(source.data)) {
          return;
        }

        setActiveDraggedPageIds(new Set(source.data.dragItems.map((entry) => entry.card.id)));
        setActiveDropColumnId(null);
        setBlockedDropMessage(null);
        setDropIndicator(null);
        if (
          selectedPageIds.size > 0
          && !selectedPageIds.has(source.data.sourcePageId)
        ) {
          setCardSelection(emptyCardSelection());
        }
    },
    onDrag: ({ source, location }) => {
        if (!isKanbanCardDragData(source.data)) {
          return;
        }

        const pointer = {
          x: location.current.input.clientX,
          y: location.current.input.clientY,
        };
        const nextIndicator = resolveKanbanDropLocation({
          visibleBoard: filteredBoard,
          dropTargets: location.current.dropTargets as Array<{ data: Record<string | symbol, unknown> }>,
          sourceData: source.data,
          draggedPageIds: source.data.dragItems.map((entry) => entry.card.id),
          pointerY: pointer.y,
          resolveColumnSurface,
        });
        const nextDropIntent = nextIndicator
          ? resolveKanbanCardDropIntent({
            board,
            visibleBoard: filteredBoard,
            rules: viewPrefs.rules,
            destinationColumnId: nextIndicator.columnId,
            destinationIndex: nextIndicator.index,
            dragItems: source.data.dragItems,
          })
          : null;
        setActiveDropColumnId((current) => {
          const nextColumnId = nextDropIntent?.kind === "move-only"
            || nextDropIntent?.kind === "blocked"
            ? nextIndicator?.columnId ?? null
            : null;
          return current === nextColumnId ? current : nextColumnId;
        });
        setBlockedDropMessage((current) => {
          if (nextDropIntent?.kind !== "blocked") {
            return current ? null : current;
          }
          if (current?.columnId === nextDropIntent.columnId && current.message === nextDropIntent.message) {
            return current;
          }
          return {
            columnId: nextDropIntent.columnId,
            message: nextDropIntent.message,
          };
        });
        if (nextDropIntent?.kind !== "reorder" && nextDropIntent?.kind !== "reorder-with-patch") {
          setDropIndicator((current) => current ? null : current);
          return;
        }

        if (!nextIndicator) {
          setActiveDropColumnId((current) => current ? null : current);
          setDropIndicator((current) => current ? null : current);
          return;
        }

        const nextLabel = nextDropIntent.kind === "reorder-with-patch"
          ? nextDropIntent.previewLabel
          : undefined;
        const feedback = resolveKanbanDropFeedback({
          visibleBoard: filteredBoard,
          columnId: nextIndicator.columnId,
          visibleIndex: nextIndicator.index,
          showSlotIndicator: true,
          ...(nextLabel ? { label: nextLabel } : {}),
        });

        setActiveDropColumnId((current) =>
          current === feedback.activeDropColumnId ? current : feedback.activeDropColumnId,
        );
        setDropIndicator((current) => {
          const nextDropIndicator = feedback.dropIndicator;
          if (!nextDropIndicator) {
            return current ? null : current;
          }
          if (
            current?.columnId === nextDropIndicator.columnId
            && current.index === nextDropIndicator.index
            && current.label === nextDropIndicator.label
          ) {
            return current;
          }
          return nextDropIndicator;
        });
    },
    onDrop: async ({ source, location }) => {
        if (!isKanbanCardDragData(source.data)) {
          clearBoardCardDragState();
          return;
        }

        const pointer = {
          x: location.current.input.clientX,
          y: location.current.input.clientY,
        };
        setDropIndicator(null);

        try {
          await performCardDrop(
            source.data,
            location.current.dropTargets as Array<{ data: Record<string | symbol, unknown> }>,
            pointer,
          );
        } finally {
          clearBoardCardDragState();
        }
    },
  });

  const handleAddCard = useCallback(async (
    columnId: string,
    input: PageInput,
    placement: PageCreatePlacement = "bottom",
  ) => {
    await createPage(columnId, input, placement);
  }, [createPage]);

  const openPageStageFromCard = useCallback(async (
    card: CardType,
    openMode: KanbanCardOpenMode,
  ) => {
    if (openMode === "preview" && pageStagePageId === card.id) {
      await pageStageCloseRef?.current?.();
      return;
    }
    openPageStage(projectId, card.id, card.title, { openMode });
  }, [
    pageStagePageId,
    pageStageCloseRef,
    openPageStage,
    projectId,
  ]);

  const openPageFromMenu = useCallback(async (input: OpenPageInNewChatInput) => {
    await openPageStage(input.projectId, input.pageId, input.titleSnapshot, {
      openMode: "durable",
    });
  }, [openPageStage]);

  const handleEditCard = useCallback((
    columnId: string,
    card: CardType,
    event: React.MouseEvent<HTMLDivElement>,
    openMode: KanbanCardOpenMode = "preview",
  ) => {
    if (event.shiftKey) {
      event.preventDefault();
      clearPendingCardPreviewOpen();
      setCardSelection((current) => toggleCardSelection(current, card.id));
      return;
    }

    if (openMode === "preview" && event.detail > 1) return;

    if (selectedPageIds.size > 0) {
      setCardSelection(emptyCardSelection());
    }

    clearPendingCardPreviewOpen();
    if (openMode === "durable") {
      void openPageStageFromCard(card, "durable");
      return;
    }

    pendingCardPreviewOpenRef.current = setTimeout(() => {
      pendingCardPreviewOpenRef.current = null;
      void openPageStageFromCard(card, "preview");
    }, KANBAN_CARD_PREVIEW_OPEN_DELAY_MS);
  }, [
    clearPendingCardPreviewOpen,
    openPageStageFromCard,
    selectedPageIds.size,
  ]);

  const handleCardMenuOpen = useCallback((pageId: string) => {
    setCardSelection({
      pageIds: new Set([pageId]),
    });
  }, []);

  const handleDeletePageFromMenu = useCallback(
    async ({
      pageId,
      columnId,
    }: {
      pageId: string;
      columnId: string;
    }) => {
      const deleted = await deletePage(columnId, pageId);
      if (!deleted) {
        await refresh();
        return;
      }

      if (pageStagePageId === pageId) {
        await pageStageCloseRef?.current?.();
      }

      setCardSelection(emptyCardSelection());
    },
    [pageStagePageId, pageStageCloseRef, deletePage, refresh],
  );

  const handleCopyCardLinkFromMenu = useCallback(
    async ({
      pageId,
    }: {
      pageId: string;
      projectId: string;
    }) => {
      await writeTextToClipboard(buildPageDeepLink({ pageId: pageId }));
    },
    [],
  );

  const handleUpdatePageProperty = useCallback(
    async ({
      pageId,
      columnId,
      property,
      value,
    }: CardPropertyUpdateInput) => {
      const column = board?.columns.find((candidate) => candidate.id === columnId);
      const card = column?.cards.find((candidate) => candidate.id === pageId);
      if (!card) {
        return;
      }

      if (property === "priority") {
        if ((card.priority ?? "none") === value) {
          return;
        }
        await updatePage(columnId, pageId, {
          priority: value === "none" ? null : (value as CardType["priority"]),
        });
        return;
      }

      const nextEstimate = value === "none" ? null : value;
      if ((card.estimate ?? null) === nextEstimate) {
        return;
      }

      await updatePage(columnId, pageId, {
        estimate: nextEstimate as CardType["estimate"],
      });
    },
    [board, updatePage],
  );

  const updateColumnLayout = useCallback((
    columnId: WorkflowStatus,
    patch: { collapsed?: boolean; width?: number },
  ) => {
    setColumnLayoutPrefs((current) => {
      const next = updateKanbanColumnLayoutPrefs(current, columnId, patch);
      writeKanbanColumnLayoutPrefs(projectId, next);
      return next;
    });
  }, [projectId]);

  // Loading state
  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-sm text-(--foreground-secondary)">
          Loading board...
        </div>
      </div>
    );
  }

  // A full-view error is only warranted when the first window never loaded;
  // with content on screen, refresh/continuation failures stay non-destructive.
  if (error && !board) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-sm text-(--destructive)">
          Error: {error}
        </div>
      </div>
    );
  }

  if (!board || !filteredBoard) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <KanbanBoardScrollContainer ref={boardScrollContainerRef} scrollStateKey={scrollStateKey}>
        {/* Board container - Notion-style scroll with sticky headers */}
        <div className="flex w-max min-w-full px-4">
          {filteredBoard.columns.map((column) => (
            <Column
              projectId={projectId}
              projectName={currentProjectName}
              key={column.id}
              column={column}
              pagination={groupPagination.get(groupScopeKeyForColumn(column.id))
                ?? groupPagination.get(UNGROUPED_SCOPE_KEY)}
              onLoadMore={loadMoreGroup}
              displayPrefs={viewPrefs.display}
              dragInstanceId={dragInstanceId}
              buildDragData={buildDragData}
              layout={getKanbanColumnLayout(columnLayoutPrefs, column.id)}
              onAddCard={handleAddCard}
              onEditCard={handleEditCard}
              onUpdatePageProperty={handleUpdatePageProperty}
              onCollapsedChange={(columnId, collapsed) => updateColumnLayout(columnId, { collapsed })}
              onWidthChange={(columnId, width) => updateColumnLayout(columnId, { width })}
              onDeletePageFromMenu={handleDeletePageFromMenu}
              onCopyCardLinkFromMenu={handleCopyCardLinkFromMenu}
              onOpenPageFromMenu={openPageFromMenu}
              onOpenPageInNewChatFromMenu={onOpenPageInNewChat}
              onSendPageToChatFromMenu={onSendPageToChat}
              onOpenPageMenu={handleCardMenuOpen}
              cardDropDisabled={!dropCapabilities.allowPageTargets}
              columnDropDisabled={!dropCapabilities.allowColumnTargets}
              dropIndicatorIndex={
                dropIndicator?.columnId === column.id
                  ? dropIndicator.index
                  : undefined
              }
              dropIndicatorLabel={
                dropIndicator?.columnId === column.id
                  ? dropIndicator.label
                  : undefined
              }
              draggedPageIds={activeDraggedPageIds}
              isDropTargetActive={activeDropColumnId === column.id}
              dropBlockedMessage={
                blockedDropMessage?.columnId === column.id
                  ? blockedDropMessage.message
                  : undefined
              }
              focusedPageId={pageStagePageId}
              activePanelPageStagePageIds={activePanelPageStagePageIds}
              selectedPageIds={selectedPageIds}
              onExternalBlockDragOver={handleExternalBlockDragOver}
              onExternalBlockDragLeave={handleExternalBlockDragLeave}
              onExternalBlockDrop={(columnId, event) => {
                void handleExternalBlockDrop(columnId, event);
              }}
            />
          ))}
        </div>
      </KanbanBoardScrollContainer>
    </div>
  );
}
