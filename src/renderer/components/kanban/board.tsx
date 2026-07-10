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
import { computeNativeDropIndexFromSurface } from "./native-drop-index";
import { KanbanBoardScrollContainer } from "./view-scroll-containers";
import {
  clearCardDropTargetHover,
  updateCardDropTargetHover,
} from "./editor/card-drop-target-registry";
import {
  endExternalCardDragSession,
  getActiveExternalCardDragSession,
  startExternalCardDragSession,
  updateExternalCardDragPointer,
} from "./editor/external-card-drag-session";
import {
  claimExternalEditorDragSession,
  discardExternalEditorDragSession,
  getActiveExternalEditorDragSession,
} from "./editor/external-block-drag-session";
import {
  claimCrossWindowDrag,
  completeCrossWindowDrag,
  discardCrossWindowDrag,
  useCrossWindowDragPreview,
} from "@/lib/cross-window-drag";
import { toast } from "@/components/ui/toast";
import { buildCardDeepLink } from "@/lib/card-deeplink";
import {
  getKanbanColumnLayout,
  readKanbanColumnLayoutPrefs,
  updateKanbanColumnLayoutPrefs,
  writeKanbanColumnLayoutPrefs,
  type KanbanColumnLayoutPrefs,
} from "@/lib/kanban-column-layout";
import { useKanban } from "@/lib/use-kanban";
import { useHistory } from "@/lib/use-history";
import { useKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts";
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
import {
  formatDragDropLabel,
  NODEX_NFM_BLOCKS_DRAG_MIME,
  parseCrossWindowDragToken,
  resolveDragTransferOperation,
} from "../../../shared/cross-window-drag";
import { buildCardSearchText, matchesSearchTokens, tokenizeSearchQuery } from "@/lib/card-search";
import { resolveExternalCardDropTarget } from "./board-drop-routing";
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
import {
  resolveKanbanImportInference,
  resolveKanbanImportPreviewLabel,
} from "./kanban-import-inference";
import { resolveKanbanDropFeedback } from "./drop-feedback";

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
  projects,
  searchQuery,
  dbViewPrefs,
  openCardStage,
  cardStageCardId,
  activePanelCardStageCardIds,
  cardStageCloseRef,
  scrollStateKey,
}: KanbanBoardProps) {
  // History hooks
  const {
    sessionId,
    undo,
    redo,
    refreshState: refreshHistoryState,
  } = useHistory(projectId);
  const pendingCardPreviewOpenRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crossWindowDragPreview = useCrossWindowDragPreview();

  const clearPendingCardPreviewOpen = useCallback(() => {
    if (pendingCardPreviewOpenRef.current === null) return;
    clearTimeout(pendingCardPreviewOpenRef.current);
    pendingCardPreviewOpenRef.current = null;
  }, []);

  useEffect(() => clearPendingCardPreviewOpen, [clearPendingCardPreviewOpen]);

  // Pass sessionId to kanban hook so all mutations are tracked
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
    importBlockDrop,
    refresh,
  } =
    useKanban({
      projectId,
      sessionId,
      onMutation: refreshHistoryState,
    });

  // Keyboard shortcuts for undo/redo
  const handleUndo = useCallback(async () => {
    const success = await undo();
    if (success) {
      refresh(); // Refresh board after undo
    }
  }, [undo, refresh]);

  const handleRedo = useCallback(async () => {
    const success = await redo();
    if (success) {
      refresh(); // Refresh board after redo
    }
  }, [redo, refresh]);

  useKeyboardShortcuts({
    onUndo: handleUndo,
    onRedo: handleRedo,
    enabled: !loading,
  });

  const [cardSelection, setCardSelection] = useState<CardSelectionState>(() => emptyCardSelection());
  const externalCardDragSessionIdRef = useRef<string | undefined>(undefined);
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
  const isKanbanCardDragActive = activeDraggedCardIds.size > 0;

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
    clearCardDropTargetHover();
    endExternalCardDragSession(externalCardDragSessionIdRef.current);
    externalCardDragSessionIdRef.current = undefined;
  }, []);

  const performCardDrop = useCallback(async (
    dragData: KanbanCardDragData,
    dropTargets: ReadonlyArray<{ data: Record<string | symbol, unknown> }>,
    pointer: { x: number; y: number } | null,
    operation: "move" | "copy",
  ) => {
    const cardDragSession = getActiveExternalCardDragSession();

    if (cardDragSession) {
      const target = resolveExternalCardDropTarget(cardDragSession);
      if (target && cardDragSession.pointer) {
        void discardCrossWindowDrag(cardDragSession.id);
        const committed = await target.performDrop(
          cardDragSession.payload,
          cardDragSession.pointer,
          operation,
          cardDragSession.groupId,
        );
        if (!committed) {
          toast.danger("Could not complete drop; the source was unchanged.");
        }

        endExternalCardDragSession(externalCardDragSessionIdRef.current);
        externalCardDragSessionIdRef.current = undefined;
        return;
      }
    }

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

        endExternalCardDragSession(externalCardDragSessionIdRef.current);
        externalCardDragSessionIdRef.current = startExternalCardDragSession({
          projectId: source.data.projectId,
          cards: source.data.dragItems,
        }, {
          id: source.data.crossWindowSessionId,
          groupId: source.data.groupId,
        });
        setActiveDraggedCardIds(new Set(source.data.dragItems.map((entry) => entry.card.id)));
        setActiveDropColumnId(null);
        setBlockedDropMessage(null);
        clearCardDropTargetHover();
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
        updateExternalCardDragPointer(externalCardDragSessionIdRef.current, pointer);
        updateCardDropTargetHover(pointer, {
          projectId: source.data.projectId,
          cards: source.data.dragItems,
        }, resolveDragTransferOperation(location.current.input.altKey));

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
        updateExternalCardDragPointer(externalCardDragSessionIdRef.current, pointer);
        clearCardDropTargetHover();
        setDropIndicator(null);

        try {
          await performCardDrop(
            source.data,
            location.current.dropTargets as Array<{ data: Record<string | symbol, unknown> }>,
            pointer,
            resolveDragTransferOperation(location.current.input.altKey),
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

  const handleNativeDragOver = useCallback(
    (columnId: string, event: React.DragEvent<HTMLDivElement>) => {
      if (isKanbanCardDragActive) {
        return;
      }

      const session = getActiveExternalEditorDragSession();
      const externalPreview = crossWindowDragPreview?.kind === "blocks"
        && event.dataTransfer.types.includes(NODEX_NFM_BLOCKS_DRAG_MIME)
        ? crossWindowDragPreview
        : null;
      const cards = session?.cards ?? externalPreview?.cards;
      if (!cards || cards.length === 0) {
        setDropIndicator(null);
        setActiveDropColumnId(null);
        return;
      }

      event.preventDefault();
      const operation = resolveDragTransferOperation(event.altKey);
      event.dataTransfer.dropEffect = operation;
      const targetVisibleIndex = computeNativeDropIndexFromSurface(
        event.currentTarget,
        event.clientY,
      );
      const inference = resolveKanbanImportInference({
        board,
        visibleBoard: filteredBoard,
        rules: viewPrefs.rules,
        targetColumnId: columnId as CardType["status"],
        targetVisibleIndex,
        cards,
        hasSearchFilter,
      });
      if (inference.mode === "blocked") {
        setDropIndicator(null);
        setActiveDropColumnId(null);
        return;
      }

      const feedback = resolveKanbanDropFeedback({
        visibleBoard: filteredBoard,
        columnId: columnId as CardType["status"],
        visibleIndex: targetVisibleIndex,
        showSlotIndicator: inference.mode === "slot",
        label: formatDragDropLabel(
          operation,
          resolveKanbanImportPreviewLabel(cards, inference.cards),
        ),
      });
      setDropIndicator(feedback.dropIndicator);
      setActiveDropColumnId(feedback.activeDropColumnId);
    },
    [
      board,
      crossWindowDragPreview,
      filteredBoard,
      hasSearchFilter,
      isKanbanCardDragActive,
      viewPrefs.rules,
    ],
  );

  const handleNativeDragLeave = useCallback(
    (columnId: string, event: React.DragEvent<HTMLDivElement>) => {
      if (isKanbanCardDragActive) {
        return;
      }

      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return;
      }

      setDropIndicator((current) => {
        if (!current || current.columnId !== columnId) return current;
        return null;
      });
      setActiveDropColumnId(null);
    },
    [isKanbanCardDragActive],
  );

  const handleNativeDrop = useCallback(
    async (columnId: string, event: React.DragEvent<HTMLDivElement>) => {
      if (isKanbanCardDragActive) {
        return;
      }

      setDropIndicator(null);
      setActiveDropColumnId(null);

      const token = parseCrossWindowDragToken(
        event.dataTransfer.getData(NODEX_NFM_BLOCKS_DRAG_MIME),
      );
      if (!token) return;

      event.preventDefault();
      event.stopPropagation();

      const operation = resolveDragTransferOperation(event.altKey);
      const localSession = getActiveExternalEditorDragSession();
      const claimedLocalSession = localSession?.id === token.sessionId
        ? claimExternalEditorDragSession(token.sessionId)
        : null;
      const externalClaim = claimedLocalSession
        ? null
        : await claimCrossWindowDrag({ sessionId: token.sessionId, kind: "blocks" });
      const payload = claimedLocalSession
        ? {
            cards: claimedLocalSession.cards,
            sourceUpdates: claimedLocalSession.sourceUpdates,
            groupId: claimedLocalSession.groupId,
          }
        : externalClaim?.kind === "blocks"
          ? externalClaim.payload
          : null;
      if (!payload) {
        toast.danger("Could not complete drop; the source was unchanged.");
        return;
      }

      const targetVisibleIndex = computeNativeDropIndexFromSurface(
        event.currentTarget,
        event.clientY,
      );
      const inference = resolveKanbanImportInference({
        board,
        visibleBoard: filteredBoard,
        rules: viewPrefs.rules,
        targetColumnId: columnId as CardType["status"],
        targetVisibleIndex,
        cards: payload.cards,
        hasSearchFilter,
      });
      if (inference.mode === "blocked") {
        if (claimedLocalSession) {
          discardExternalEditorDragSession(token.sessionId, "cancel");
        } else {
          await completeCrossWindowDrag({ sessionId: token.sessionId, result: "cancel" });
        }
        return;
      }

      try {
        const result = await importBlockDrop({
          targetStatus: columnId as CardType["status"],
          ...(inference.mode === "slot" ? { insertIndex: inference.insertIndex } : {}),
          cards: inference.cards,
          sourceUpdates: operation === "move" ? payload.sourceUpdates : [],
          groupId: payload.groupId,
        });

        if (!result) {
          if (claimedLocalSession) {
            discardExternalEditorDragSession(token.sessionId, "cancel");
          } else {
            await completeCrossWindowDrag({ sessionId: token.sessionId, result: "cancel" });
          }
          toast.danger("Could not complete drop; the source was unchanged.");
          return;
        }

        if (claimedLocalSession) {
          discardExternalEditorDragSession(token.sessionId, operation);
        } else {
          await completeCrossWindowDrag({ sessionId: token.sessionId, result: operation });
        }
      } catch {
        if (claimedLocalSession) {
          discardExternalEditorDragSession(token.sessionId, "cancel");
        } else {
          await completeCrossWindowDrag({ sessionId: token.sessionId, result: "cancel" });
        }
        toast.danger("Could not complete drop; the source was unchanged.");
      }
    },
    [board, filteredBoard, hasSearchFilter, importBlockDrop, isKanbanCardDragActive, viewPrefs.rules],
  );

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
              onNativeDragOver={handleNativeDragOver}
              onNativeDragLeave={handleNativeDragLeave}
              onNativeDrop={handleNativeDrop}
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
            />
          ))}
        </div>
      </KanbanBoardScrollContainer>
    </div>
  );
}
