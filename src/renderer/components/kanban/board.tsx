import { useState, useEffect, useCallback, useDeferredValue, useMemo, useRef } from "react";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Column } from "./column";
import { type CardPropertyUpdateInput } from "./card";
import type { OpenCardStageOptions } from "./open-card-stage";
import {
  emptyCardSelection,
  normalizeCardSelection,
  toggleCardSelection,
  type CardSelectionState,
} from "./card-selection";
import { KanbanBoardScrollContainer } from "./view-scroll-containers";
import { buildCardDeepLink } from "@/lib/card-deeplink";
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
  CardSummary,
  CardStatus,
  CardCreatePlacement,
  CardInput,
  Project,
} from "@/lib/types";
import { buildCardSearchText, matchesSearchTokens, tokenizeSearchQuery } from "@/lib/card-search";
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
  hasDragType,
  NODEX_BLOCK_CARD_COPIES_DRAG_MIME,
  NODEX_CARD_REFERENCES_DRAG_MIME,
  parseBlockCardCopyDragPayload,
  parseCardReferenceDragPayload,
} from "./cross-surface-drag";
import { toast } from "@/components/ui/toast";

const KANBAN_CARD_PREVIEW_OPEN_DELAY_MS = 180;
type KanbanCardOpenMode = NonNullable<OpenCardStageOptions["openMode"]>;
type CardType = CardSummary;

function hasSameCardSelection(
  left: CardSelectionState,
  right: CardSelectionState,
): boolean {
  if (left.cardIds.size !== right.cardIds.size) return false;

  for (const cardId of left.cardIds) {
    if (!right.cardIds.has(cardId)) return false;
  }

  return true;
}

interface KanbanBoardProps {
  projectId: string;
  databaseViewId: string;
  projects: Project[];
  searchQuery: string;
  dbViewPrefs: DbViewPrefs | null;
  openCardStage: (
    projectId: string,
    cardId: string,
    titleSnapshot?: string,
    options?: OpenCardStageOptions,
  ) => void;
  cardStageCardId: string | undefined;
  activePanelCardStageCardIds?: ReadonlySet<string>;
  cardStageCloseRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  scrollStateKey?: string | null;
}

export function KanbanBoard({
  projectId,
  databaseViewId,
  projects,
  searchQuery,
  dbViewPrefs,
  openCardStage,
  cardStageCardId,
  activePanelCardStageCardIds,
  cardStageCloseRef,
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
    loading,
    error,
    createCard,
    updateCard,
    deleteCard,
    moveCard,
    moveCards,
    moveCardToProject,
    refresh,
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
  const [activeDraggedCardIds, setActiveDraggedCardIds] = useState<ReadonlySet<string>>(() => new Set());

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
        const columnCards = column.cards.map<DbViewCardRecord>((card, cardIndex) => ({
          ...card,
          columnId: column.id,
          columnName: column.name,
          boardIndex: columnIndex * 100_000 + cardIndex,
        }));
        const filteredByRules = filterDbViewCards(columnCards, viewPrefs.rules);
        const filteredBySearch = hasSearchFilter
          ? filteredByRules.filter((card) =>
            matchesSearchTokens(
              `${buildCardSearchText(card)} ${card.columnName.toLowerCase()}`,
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

  const contextMenuProjects = useMemo(
    () => projects.map((project) => ({
      id: project.id,
      name: project.name,
      icon: project.icon,
      description: project.description,
      primaryWorkspaceRoot: project.primaryWorkspaceRoot,
    })),
    [projects],
  );

  const selectedCardIds = cardSelection.cardIds;

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
      activeCard: card,
      columnId: columnId as CardStatus,
    }),
    [board, cardSelection, dragInstanceId, filteredBoard, projectId],
  );

  const clearBoardCardDragState = useCallback(() => {
    setDropIndicator(null);
    setActiveDropColumnId(null);
    setBlockedDropMessage(null);
    setActiveDraggedCardIds(new Set());
  }, []);

  const handleExternalBlockDragOver = useCallback(
    (columnId: CardStatus, event: React.DragEvent<HTMLDivElement>) => {
      const copiesBlocks = hasDragType(
        event.dataTransfer,
        NODEX_BLOCK_CARD_COPIES_DRAG_MIME,
      );
      const movesReference = hasDragType(
        event.dataTransfer,
        NODEX_CARD_REFERENCES_DRAG_MIME,
      );
      if (!copiesBlocks && !movesReference) return;

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = movesReference ? "move" : "copy";
      const index = computeNativeDropIndexFromSurface(
        event.currentTarget,
        event.clientY,
      );
      setActiveDropColumnId(columnId);
      setDropIndicator({
        columnId,
        index,
        label: movesReference ? "Move referenced Card" : "Copy as Card",
      });
      setBlockedDropMessage(null);
    },
    [],
  );

  const handleExternalBlockDragLeave = useCallback(
    (columnId: CardStatus, event: React.DragEvent<HTMLDivElement>) => {
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
    async (columnId: CardStatus, event: React.DragEvent<HTMLDivElement>) => {
      const referencePayload = parseCardReferenceDragPayload(
        event.dataTransfer.getData(NODEX_CARD_REFERENCES_DRAG_MIME),
      );
      const payload = parseBlockCardCopyDragPayload(
        event.dataTransfer.getData(NODEX_BLOCK_CARD_COPIES_DRAG_MIME),
      );
      if (!referencePayload && !payload) return;

      event.preventDefault();
      event.stopPropagation();
      const destinationIndex = computeNativeDropIndexFromSurface(
        event.currentTarget,
        event.clientY,
      );
      setActiveDropColumnId(null);
      setDropIndicator(null);
      setBlockedDropMessage(null);

      if (referencePayload) {
        for (const reference of referencePayload.cards) {
          const source = board?.columns
            .flatMap((column) =>
              column.cards.map((card) => ({ card, columnId: column.id })),
            )
            .find((entry) => entry.card.id === reference.cardId);
          if (!source) {
            toast.danger(
              "That referenced Card is not a member of this Database.",
            );
            continue;
          }
          const dropIntent = resolveKanbanCardDropIntent({
            board,
            visibleBoard: filteredBoard,
            rules: viewPrefs.rules,
            destinationColumnId: columnId,
            destinationIndex,
            dragItems: [source],
          });
          if (dropIntent.kind === "blocked") {
            toast.danger(dropIntent.message);
            continue;
          }
          const newOrder = dropIntent.kind === "reorder"
            || dropIntent.kind === "reorder-with-patch"
            ? dropIntent.newOrder
            : undefined;
          const fieldPatch = dropIntent.kind === "reorder-with-patch"
            ? dropIntent.fieldPatch
            : undefined;
          await moveCard({
            cardId: reference.cardId,
            fromStatus: source.columnId,
            toStatus: columnId,
            ...(typeof newOrder === "number" ? { newOrder } : {}),
            ...(fieldPatch ? { fieldPatch } : {}),
          });
        }
        return;
      }

      const destinationCards = filteredBoard?.columns.find(
        (column) => column.id === columnId,
      )?.cards ?? [];
      const beforeCardId = destinationCards[destinationIndex]?.id;
      const placement: CardCreatePlacement =
        resolveKanbanCardDragMode({ rules: viewPrefs.rules }).kind === "manual-rank"
          && beforeCardId
          ? { beforeCardId }
          : "bottom";
      for (const card of payload!.cards) {
        const created = await createCard(columnId, card, placement);
        if (!created) break;
      }
    },
    [board, createCard, filteredBoard, moveCard, viewPrefs.rules],
  );

  const performCardDrop = useCallback(async (
    dragData: KanbanCardDragData,
    dropTargets: ReadonlyArray<{ data: Record<string | symbol, unknown> }>,
    pointer: { x: number; y: number } | null,
  ) => {
    const dragCardIds = dragData.dragItems.map((entry) => entry.card.id);
    const destination = resolveKanbanDropLocation({
      visibleBoard: filteredBoard,
      dropTargets,
      sourceData: dragData,
      draggedCardIds: dragCardIds,
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
      ? (dragData.dragItems[0]?.columnId as CardStatus | undefined)
      : undefined;
    const newOrder = dropIntent.kind === "reorder" || dropIntent.kind === "reorder-with-patch"
      ? dropIntent.newOrder
      : undefined;
    const fieldPatch = dropIntent.kind === "reorder-with-patch"
      ? dropIntent.fieldPatch
      : undefined;

    if (dragCardIds.length > 1) {
      const moved = await moveCards({
        cardIds: dragCardIds,
        ...(sharedSourceColumnId ? { fromStatus: sharedSourceColumnId } : {}),
        toStatus: destination.columnId,
        ...(typeof newOrder === "number" ? { newOrder } : {}),
        ...(fieldPatch ? { fieldPatch } : {}),
      });
      if (!moved) return;

      setCardSelection({
        cardIds: new Set(dragCardIds),
      });
      return;
    }

    const moved = await moveCard({
      cardId: dragData.sourceCardId,
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
    moveCard,
    moveCards,
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

  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => isKanbanCardDragData(source.data)
        && source.data.instanceId === dragInstanceId,
      onDragStart: ({ source }) => {
        if (!isKanbanCardDragData(source.data)) {
          return;
        }

        setActiveDraggedCardIds(new Set(source.data.dragItems.map((entry) => entry.card.id)));
        setActiveDropColumnId(null);
        setBlockedDropMessage(null);
        setDropIndicator(null);
        if (!selectedCardIds.has(source.data.sourceCardId)) {
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
          draggedCardIds: source.data.dragItems.map((entry) => entry.card.id),
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
  }, [
    clearBoardCardDragState,
    dragInstanceId,
    filteredBoard,
    performCardDrop,
    resolveColumnSurface,
    selectedCardIds,
    board,
    viewPrefs.rules,
  ]);

  const handleAddCard = useCallback(async (
    columnId: string,
    input: CardInput,
    placement: CardCreatePlacement = "bottom",
  ) => {
    await createCard(columnId, input, placement);
  }, [createCard]);

  const openCardStageFromCard = useCallback(async (
    card: CardType,
    openMode: KanbanCardOpenMode,
  ) => {
    if (openMode === "preview" && cardStageCardId === card.id) {
      await cardStageCloseRef?.current?.();
      return;
    }
    openCardStage(projectId, card.id, card.title, { openMode });
  }, [
    cardStageCardId,
    cardStageCloseRef,
    openCardStage,
    projectId,
  ]);

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

    if (selectedCardIds.size > 0) {
      setCardSelection(emptyCardSelection());
    }

    clearPendingCardPreviewOpen();
    if (openMode === "durable") {
      void openCardStageFromCard(card, "durable");
      return;
    }

    pendingCardPreviewOpenRef.current = setTimeout(() => {
      pendingCardPreviewOpenRef.current = null;
      void openCardStageFromCard(card, "preview");
    }, KANBAN_CARD_PREVIEW_OPEN_DELAY_MS);
  }, [
    clearPendingCardPreviewOpen,
    openCardStageFromCard,
    selectedCardIds.size,
  ]);

  const handleCardMenuOpen = useCallback((cardId: string) => {
    setCardSelection({
      cardIds: new Set([cardId]),
    });
  }, []);

  const handleDeleteCardFromMenu = useCallback(
    async ({
      cardId,
      columnId,
    }: {
      cardId: string;
      columnId: string;
    }) => {
      const deleted = await deleteCard(columnId, cardId);
      if (!deleted) {
        await refresh();
        return;
      }

      if (cardStageCardId === cardId) {
        await cardStageCloseRef?.current?.();
      }

      setCardSelection(emptyCardSelection());
    },
    [cardStageCardId, cardStageCloseRef, deleteCard, refresh],
  );

  const handleCopyCardLinkFromMenu = useCallback(
    async ({
      cardId,
    }: {
      cardId: string;
      projectId: string;
    }) => {
      await writeTextToClipboard(buildCardDeepLink({ cardId }));
    },
    [],
  );

  const handleMoveCardToProjectFromMenu = useCallback(
    async ({
      cardId,
      sourceStatus,
      targetProjectId,
    }: {
      cardId: string;
      sourceStatus: CardType["status"];
      targetProjectId: string;
    }) => {
      const moved = await moveCardToProject({
        cardId,
        sourceStatus,
        targetProjectId,
      });
      if (!moved) {
        await refresh();
        return;
      }

      setCardSelection(emptyCardSelection());
    },
    [moveCardToProject, refresh],
  );

  const handleUpdateCardProperty = useCallback(
    async ({
      cardId,
      columnId,
      property,
      value,
    }: CardPropertyUpdateInput) => {
      const column = board?.columns.find((candidate) => candidate.id === columnId);
      const card = column?.cards.find((candidate) => candidate.id === cardId);
      if (!card) {
        return;
      }

      if (property === "priority") {
        if ((card.priority ?? "none") === value) {
          return;
        }
        await updateCard(columnId, cardId, {
          priority: value === "none" ? null : (value as CardType["priority"]),
        });
        return;
      }

      const nextEstimate = value === "none" ? null : value;
      if ((card.estimate ?? null) === nextEstimate) {
        return;
      }

      await updateCard(columnId, cardId, {
        estimate: nextEstimate as CardType["estimate"],
      });
    },
    [board, updateCard],
  );

  const updateColumnLayout = useCallback((
    columnId: CardStatus,
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

  // Error state
  if (error) {
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
              displayPrefs={viewPrefs.display}
              dragInstanceId={dragInstanceId}
              buildDragData={buildDragData}
              layout={getKanbanColumnLayout(columnLayoutPrefs, column.id)}
              onAddCard={handleAddCard}
              onEditCard={handleEditCard}
              onUpdateCardProperty={handleUpdateCardProperty}
              onCollapsedChange={(columnId, collapsed) => updateColumnLayout(columnId, { collapsed })}
              onWidthChange={(columnId, width) => updateColumnLayout(columnId, { width })}
              onMoveCardToProjectFromMenu={handleMoveCardToProjectFromMenu}
              onDeleteCardFromMenu={handleDeleteCardFromMenu}
              onCopyCardLinkFromMenu={handleCopyCardLinkFromMenu}
              onOpenCardMenu={handleCardMenuOpen}
              cardDropDisabled={!dropCapabilities.allowCardTargets}
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
              draggedCardIds={activeDraggedCardIds}
              isDropTargetActive={activeDropColumnId === column.id}
              dropBlockedMessage={
                blockedDropMessage?.columnId === column.id
                  ? blockedDropMessage.message
                  : undefined
              }
              focusedCardId={cardStageCardId}
              activePanelCardStageCardIds={activePanelCardStageCardIds}
              selectedCardIds={selectedCardIds}
              contextMenuProjects={contextMenuProjects}
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
