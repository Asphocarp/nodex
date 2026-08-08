import { useState, useEffect, useCallback, useDeferredValue, useMemo, useRef } from "react";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { Column } from "./column";
import {
  type CardEditableProperty,
  type CardKeyboardPropertyRequest,
  type CardPropertyUpdateInput,
} from "./card";
import type { OpenPageStageOptions } from "./open-page-stage";
import {
  emptyCardSelection,
  normalizeCardSelection,
  toggleCardSelection,
  type CardSelectionState,
} from "./card-selection";
import { BoardScrollContainer } from "./view-scroll-containers";
import {
  groupScopeKeyForColumn,
  UNGROUPED_SCOPE_KEY,
} from "@/lib/board-store";
import { buildPageDeepLink } from "@/lib/page-deeplink";
import type {
  OpenPageInNewChatInput,
  SendPageToChatInput,
} from "@/lib/page-chat-actions";
import {
  getBoardColumnLayout,
  readBoardColumnLayoutPrefs,
  updateBoardColumnLayoutPrefs,
  writeBoardColumnLayoutPrefs,
  type BoardColumnLayoutPrefs,
} from "@/lib/board-column-layout";
import { useBoard } from "@/lib/use-board";
import { useMutationAuditSessionId } from "@/lib/mutation-audit-session";
import { writeTextToClipboard } from "@/lib/clipboard";
import { copyPageKeyWithFeedback } from "@/lib/copy-page-key";
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
  Project,
} from "@/lib/types";
import {
  buildPageSearchText,
  compilePageCollectionSearchQuery,
  matchesPageCollectionSearchQuery,
} from "@/lib/page-search";
import { databasePropertyValueSearchText } from "@/lib/database-property-search-text";
import {
  buildBoardCardDragData,
  isBoardCardDragData,
  type BoardCardDragData,
} from "./pragmatic-drag-data";
import { resolveBoardDropLocation } from "./pragmatic-drop-location";
import {
  resolveBoardCardDragMode,
  resolveBoardCardDropIntent,
} from "./board-card-drop-strategy";
import { resolveBoardDropCapabilities } from "./board-drop-capabilities";
import { resolveBoardDropFeedback } from "./drop-feedback";
import { computeNativeDropIndexFromSurface } from "./native-drop-index";
import {
  blockTransferDropLabel,
  buildBlockToDataSourceTransferIntent,
  containsCanvasBlockDrag,
  containsDatabaseBlockDrag,
  endLocalBlockDragSession,
  hasDragType,
  NODEX_BLOCK_TRANSFER_DRAG_MIME,
  resolveLocalBlockDragDropSession,
  resolveCrossSurfaceTransferMode,
  shouldHandleNativeCrossSurfaceDrag,
} from "./cross-surface-drag";
import { toast } from "@/components/ui/toast";
import { useBoardElementDragMonitor } from "./use-board-element-drag-monitor";
import { transferBlocks } from "@/lib/api";
import { resolveBlockDocumentMutationBarrier } from "@/lib/block-document-mutation-registry";
import { appScope, useScopeHandle } from "@/lib/maitai";
import type { PageCreateOriginKind } from "@/lib/page-create-focus";
import {
  markPageCreateTargetActive,
  registerPageCreateTarget,
  unregisterPageCreateTarget,
  type PageCreateTarget,
} from "@/lib/page-create-target-registry";
import { requestPageCreate } from "@/lib/page-create-workflow";
import { materializePageCreateTarget } from "@/lib/page-create-target";
import { usePropertyOptionRegistries } from "@/components/database/use-property-option-registries";
import { resolvePageCreatePropertyCapabilities } from "@/lib/page-create-capabilities";
import {
  markContextualKeyboardActionTargetActive,
} from "@/lib/contextual-keyboard-actions";
import { useContextualKeyboardActionTarget } from "@/lib/use-contextual-keyboard-action-target";
import type { CommandId } from "../../../shared/command-keybindings";
import type { DatabaseViewPresentationOverride } from "../../../shared/database-kernel";
import {
  findBoardKeyboardLocation,
  resolveBoardKeyboardActionPageIds,
  resolveBoardKeyboardNavigation,
  type BoardKeyboardDirection,
} from "./board-keyboard-navigation";

const BOARD_CARD_PREVIEW_OPEN_DELAY_MS = 180;
const BOARD_CARD_PEEK_HOLD_DELAY_MS = 220;
type BoardCardOpenMode = NonNullable<OpenPageStageOptions["openMode"]>;
type CardType = DatabasePageSummary;

function applyBulkTagToggle(
  currentTags: readonly string[],
  addedTag: string | undefined,
  removedTag: string | undefined,
  sourceValue?: readonly string[],
): readonly string[] {
  if (addedTag) {
    return currentTags.includes(addedTag)
      ? currentTags
      : [...currentTags, addedTag];
  }
  if (removedTag) {
    return currentTags.includes(removedTag)
      ? currentTags.filter((tag) => tag !== removedTag)
      : currentTags;
  }
  return sourceValue ?? currentTags;
}

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

interface BoardProps {
  surfaceId: string;
  panelTabId: string;
  projectId: string;
  databaseViewId: string;
  presentationOverride: DatabaseViewPresentationOverride | null;
  presentationOverrideReady: boolean;
  projects: Project[];
  searchQuery: string;
  dbViewPrefs: DbViewPrefs | null;
  showPageKey: boolean;
  openPageStage: (
    projectId: string,
    pageId: string,
    titleSnapshot?: string,
    options?: OpenPageStageOptions,
  ) => void;
  onOpenPageInNewChat?: (input: OpenPageInNewChatInput) => Promise<void> | void;
  onSendPageToChat?: (input: SendPageToChatInput) => Promise<void> | void;
  pageStagePageId: string | undefined;
  presentedPageIds?: ReadonlySet<string>;
  initialSelectedPageIds?: ReadonlySet<string>;
  onSelectedPageIdsChange?: (pageIds: ReadonlySet<string>) => void;
  pageStageCloseRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  scrollStateKey?: string | null;
}

export function Board({
  surfaceId,
  panelTabId,
  projectId,
  databaseViewId,
  presentationOverride,
  presentationOverrideReady,
  projects,
  searchQuery,
  dbViewPrefs,
  showPageKey,
  openPageStage,
  onOpenPageInNewChat,
  onSendPageToChat,
  pageStagePageId,
  presentedPageIds,
  initialSelectedPageIds,
  onSelectedPageIdsChange,
  pageStageCloseRef,
  scrollStateKey,
}: BoardProps) {
  const appHandle = useScopeHandle(appScope);
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
    updatePage,
    deletePage,
    movePage,
    movePages,
    refresh,
    groupPagination,
    loadMoreGroup,
  } =
    useBoard({
      projectId,
      databaseViewId,
      sessionId: mutationAuditSessionId,
      presentationOverride,
      presentationOverrideReady,
    });

  const [cardSelection, setCardSelection] = useState<CardSelectionState>(() =>
    initialSelectedPageIds && initialSelectedPageIds.size > 0
      ? { pageIds: new Set(initialSelectedPageIds) }
      : emptyCardSelection()
  );
  const [highlightedPageId, setHighlightedPageId] = useState<string | null>(null);
  const [keyboardPropertyRequest, setKeyboardPropertyRequest] = useState<
    CardKeyboardPropertyRequest | null
  >(null);
  const boardScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const boardRootRef = useRef<HTMLDivElement | null>(null);
  const peekPressRef = useRef<{
    readonly pageId: string;
    readonly startedAt: number;
    readonly wasOpen: boolean;
  } | null>(null);
  const [dragInstanceId] = useState(() => Symbol("board-dnd"));
  const [pageCreateRegistrationToken] = useState(() => crypto.randomUUID());
  const boardPresentedPageIds = useMemo<ReadonlySet<string>>(() => {
    if (!pageStagePageId || presentedPageIds?.has(pageStagePageId)) {
      return presentedPageIds ?? new Set();
    }
    return new Set([...(presentedPageIds ?? []), pageStagePageId]);
  }, [pageStagePageId, presentedPageIds]);

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
  const [columnLayoutPrefs, setColumnLayoutPrefs] = useState<BoardColumnLayoutPrefs>(
    () => readBoardColumnLayoutPrefs(projectId),
  );
  const databaseProperties = useMemo(
    () => databaseView?.query.properties ?? [],
    [databaseView?.query.properties],
  );
  const propertyCapabilities = useMemo(
    () => resolvePageCreatePropertyCapabilities(databaseProperties),
    [databaseProperties],
  );
  const tagsProperty = propertyCapabilities.tagsProperty;
  const requiredTagOptionIds = useMemo<Readonly<Record<string, readonly string[]>>>(() => {
    if (!tagsProperty || !board) return {};
    return {
      [tagsProperty.propertyId]: [...new Set(
        board.columns.flatMap((column) =>
          column.cards.flatMap((card) => card.tags)
        ),
      )],
    };
  }, [board, tagsProperty]);
  const propertyOptionRegistries = usePropertyOptionRegistries({
    accessContext: { kind: "project", projectId },
    properties: databaseProperties,
    requiredOptionIds: requiredTagOptionIds,
  });
  const tagOptions = useMemo(
    () => tagsProperty
      ? propertyOptionRegistries.options[tagsProperty.propertyId] ?? []
      : [],
    [propertyOptionRegistries.options, tagsProperty],
  );

  const compiledSearchQuery = useMemo(
    () => compilePageCollectionSearchQuery(deferredSearchQuery),
    [deferredSearchQuery]
  );
  const viewPrefs = dbViewPrefs ?? getDefaultDbViewPrefs("board");
  const hasSearchFilter = compiledSearchQuery.normalizedQuery.length > 0;
  const dragMode = useMemo(
    () => resolveBoardCardDragMode({ rules: viewPrefs.rules }),
    [viewPrefs.rules],
  );
  const dropCapabilities = useMemo(
    () => resolveBoardDropCapabilities({ dragMode }),
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
            matchesPageCollectionSearchQuery(
              card.pageKey,
              `${buildPageSearchText(card)} ${databasePropertyValueSearchText(
                card.tags,
                { optionBacked: true, options: tagOptions },
              )} ${card.columnName.toLowerCase()}`,
              compiledSearchQuery,
            ))
          : filteredByRules;

        return {
          ...column,
          cards: sortDbViewCards(filteredBySearch, viewPrefs.rules),
        };
      }),
    };
  }, [board, compiledSearchQuery, hasSearchFilter, tagOptions, viewPrefs.rules]);

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
    onSelectedPageIdsChange?.(cardSelection.pageIds);
  }, [cardSelection.pageIds, onSelectedPageIdsChange]);

  useEffect(() => {
    if (!filteredBoard) {
      setHighlightedPageId(null);
      return;
    }
    setHighlightedPageId((current) => {
      if (current && findBoardKeyboardLocation(filteredBoard, current)) {
        return current;
      }
      return null;
    });
  }, [filteredBoard]);

  useEffect(() => {
    setColumnLayoutPrefs(readBoardColumnLayoutPrefs(projectId));
  }, [projectId]);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );

  const pageCreateTarget = useMemo<PageCreateTarget | null>(() => {
    if (!currentProject) return null;
    return materializePageCreateTarget({
      surfaceId,
      panelTabId,
      project: currentProject,
      databaseView,
      board,
      clientSessionId: mutationAuditSessionId,
    });
  }, [
    board,
    currentProject,
    databaseView,
    mutationAuditSessionId,
    panelTabId,
    surfaceId,
  ]);

  useEffect(() => {
    if (!pageCreateTarget) {
      unregisterPageCreateTarget(
        appHandle,
        surfaceId,
        pageCreateRegistrationToken,
      );
      return;
    }
    registerPageCreateTarget(
      appHandle,
      pageCreateRegistrationToken,
      pageCreateTarget,
    );
  }, [appHandle, pageCreateRegistrationToken, pageCreateTarget, surfaceId]);

  useEffect(() => () => {
    unregisterPageCreateTarget(
      appHandle,
      surfaceId,
      pageCreateRegistrationToken,
    );
  }, [appHandle, pageCreateRegistrationToken, surfaceId]);

  const selectedPageIds = cardSelection.pageIds;
  const resolveColumnSurface = useCallback((columnId: string): HTMLElement | null => {
    if (typeof document === "undefined") return null;

    return document.querySelector<HTMLElement>(
      `[data-board-column-root][data-board-column-id="${columnId}"]`,
    );
  }, []);

  const buildDragData = useCallback(
    (card: CardType, columnId: string): BoardCardDragData => buildBoardCardDragData({
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
      if (containsCanvasBlockDrag(authoritativePayload)) {
        toast.info("Canvas can only move between Page Documents, not into a Board.");
        return;
      }
      if (containsDatabaseBlockDrag(authoritativePayload)) {
        toast.info("Database blocks can only move through a typed Database action.");
        return;
      }
      const destinationCards = filteredBoard?.columns.find(
        (column) => column.id === columnId,
      )?.cards ?? [];
      const beforePageId = destinationCards[destinationIndex]?.id;
      const sourceBarrier = resolveBlockDocumentMutationBarrier(
        authoritativePayload.sourceSurfaceId,
      );
      const sourceHead = await sourceBarrier?.flushAndFence();
      if (sourceHead && sourceHead.storeEpoch !== databaseView.storeEpoch) {
        toast.danger("The dragged Document belongs to another store generation.");
        return;
      }
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
          ...(sourceHead
            ? {
                causalDependencies: [{
                  documentId: sourceHead.documentId,
                  generation: sourceHead.generation,
                  expectedHeadSeq: sourceHead.expectedHeadSeq,
                }],
              }
            : {}),
        }),
      );
      if (!result.ok) {
        toast.danger(result.error.message);
        return;
      }
      const commitCursor = result.localCommit.status === "committed"
        ? {
            storeEpoch: result.localCommit.commit.store_epoch,
            commitSeq: result.localCommit.commit.commit_seq,
          }
        : {
            storeEpoch: result.localCommit.observed.store_epoch,
            commitSeq: result.localCommit.observed.commit_head,
          };
      await refresh(commitCursor);
    },
    [databaseView, filteredBoard, projectId, refresh],
  );

  const performCardDrop = useCallback(async (
    dragData: BoardCardDragData,
    dropTargets: ReadonlyArray<{ data: Record<string | symbol, unknown> }>,
    pointer: { x: number; y: number } | null,
  ) => {
    const dragPageIds = dragData.dragItems.map((entry) => entry.card.id);
    const destination = resolveBoardDropLocation({
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

    const dropIntent = resolveBoardCardDropIntent({
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
      canScroll: ({ source }) => isBoardCardDragData(source.data)
        && source.data.instanceId === dragInstanceId,
    });
  }, [dragInstanceId]);

  useBoardElementDragMonitor({
    scopeKey: dragInstanceId,
    canMonitor: ({ source }) => isBoardCardDragData(source.data)
      && source.data.instanceId === dragInstanceId,
    onDragStart: ({ source }) => {
        if (!isBoardCardDragData(source.data)) {
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
        if (!isBoardCardDragData(source.data)) {
          return;
        }

        const pointer = {
          x: location.current.input.clientX,
          y: location.current.input.clientY,
        };
        const nextIndicator = resolveBoardDropLocation({
          visibleBoard: filteredBoard,
          dropTargets: location.current.dropTargets as Array<{ data: Record<string | symbol, unknown> }>,
          sourceData: source.data,
          draggedPageIds: source.data.dragItems.map((entry) => entry.card.id),
          pointerY: pointer.y,
          resolveColumnSurface,
        });
        const nextDropIntent = nextIndicator
          ? resolveBoardCardDropIntent({
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
        const feedback = resolveBoardDropFeedback({
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
        if (!isBoardCardDragData(source.data)) {
          clearBoardCardDragState();
          return;
        }

        const pointer = {
          x: location.current.input.clientX,
          y: location.current.input.clientY,
        };
        const drop = performCardDrop(
          source.data,
          location.current.dropTargets as Array<{ data: Record<string | symbol, unknown> }>,
          pointer,
        );
        // performCardDrop publishes the optimistic Board synchronously before
        // its first await. Gesture-only feedback can end at that handoff; it
        // must not linger for the network acknowledgement.
        clearBoardCardDragState();
        await drop;
    },
  });

  const handleRequestCreatePage = useCallback((
    columnId: WorkflowStatus,
    originKind: PageCreateOriginKind,
  ) => {
    if (!pageCreateTarget) {
      toast.danger("Page creation is unavailable until the Project is loaded.");
      return;
    }
    if (pageCreateTarget.readOnlyReason) {
      toast.danger(pageCreateTarget.readOnlyReason);
      return;
    }

    markPageCreateTargetActive(appHandle, surfaceId, columnId);
    requestPageCreate(appHandle, {
      target: pageCreateTarget,
      origin: {
        surfaceId,
        panelTabId,
        projectId,
        databaseViewId,
        kind: originKind,
        columnId,
      },
    });
  }, [
    appHandle,
    databaseViewId,
    pageCreateTarget,
    panelTabId,
    projectId,
    surfaceId,
  ]);

  const openPageStageFromCard = useCallback(async (
    card: CardType,
    openMode: BoardCardOpenMode,
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
    openMode: BoardCardOpenMode = "preview",
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
    }, BOARD_CARD_PREVIEW_OPEN_DELAY_MS);
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

  const handleCopyPageKeyFromMenu = useCallback(
    async ({ pageKey }: { pageKey: string }) => {
      await copyPageKeyWithFeedback(pageKey);
    },
    [],
  );

  const handleUpdatePageProperty = useCallback(
    async ({
      pageId,
      property,
      value,
    }: CardPropertyUpdateInput) => {
      if (!board) return;
      const targetPageIds = selectedPageIds.has(pageId)
        ? [...selectedPageIds]
        : [pageId];
      const entries = board.columns.flatMap((column) =>
        column.cards
          .filter((card) => targetPageIds.includes(card.id))
          .map((card) => ({ card, columnId: column.id })),
      );
      if (entries.length === 0) return;

      if (property === "status") {
        const toStatus = value as WorkflowStatus;
        if (entries.every((entry) => entry.columnId === toStatus)) return;
        if (entries.length === 1) {
          const entry = entries[0]!;
          await movePage({
            pageId: entry.card.id,
            fromStatus: entry.columnId,
            toStatus,
          });
          return;
        }
        await movePages({
          pageIds: entries.map((entry) => entry.card.id),
          toStatus,
        });
        return;
      }

      if (property === "tags") {
        const sourceCard = entries.find((entry) => entry.card.id === pageId)?.card;
        if (!sourceCard) return;
        const addedTag = value.find((tag) => !sourceCard.tags.includes(tag));
        const removedTag = sourceCard.tags.find((tag) => !value.includes(tag));
        await Promise.all(entries.map(async (entry) => {
          const nextTags = applyBulkTagToggle(
            entry.card.tags,
            addedTag,
            removedTag,
            entry.card.id === pageId ? value : undefined,
          );
          if (nextTags === entry.card.tags) return;
          await updatePage(entry.columnId, entry.card.id, { tags: [...nextTags] });
        }));
        return;
      }

      if (property === "priority") {
        await Promise.all(entries.map(async (entry) => {
          if ((entry.card.priority ?? "none") === value) return;
          await updatePage(entry.columnId, entry.card.id, {
            priority: value === "none" ? null : (value as CardType["priority"]),
          });
        }));
        return;
      }

      const nextEstimate = value === "none" ? null : value;
      await Promise.all(entries.map(async (entry) => {
        if ((entry.card.estimate ?? null) === nextEstimate) return;
        await updatePage(entry.columnId, entry.card.id, {
          estimate: nextEstimate as CardType["estimate"],
        });
      }));
    },
    [board, movePage, movePages, selectedPageIds, updatePage],
  );

  const resolveHighlightedCard = useCallback(() => {
    if (!filteredBoard || !highlightedPageId) return null;
    const location = findBoardKeyboardLocation(filteredBoard, highlightedPageId);
    if (!location) return null;
    const card = filteredBoard.columns[location.columnIndex]?.cards[location.cardIndex];
    return card ? { card, location } : null;
  }, [filteredBoard, highlightedPageId]);

  const highlightCard = useCallback((pageId: string, focus = false) => {
    setHighlightedPageId(pageId);
    markContextualKeyboardActionTargetActive(surfaceId);
    if (!focus || typeof document === "undefined") return;
    requestAnimationFrame(() => {
      const element = boardRootRef.current?.querySelector<HTMLElement>(
        `[data-board-uuid-v7="${pageId}"]`,
      );
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [surfaceId]);

  const navigateBoardHighlight = useCallback((direction: BoardKeyboardDirection) => {
    if (!filteredBoard) return false;
    const next = resolveBoardKeyboardNavigation(
      filteredBoard,
      highlightedPageId,
      direction,
    );
    if (!next) return false;
    highlightCard(next.pageId, true);
    if (pageStagePageId) {
      const card = filteredBoard.columns[next.columnIndex]?.cards[next.cardIndex];
      if (card) void openPageStageFromCard(card, "preview");
    }
    return true;
  }, [
    filteredBoard,
    highlightCard,
    highlightedPageId,
    openPageStageFromCard,
    pageStagePageId,
  ]);

  const requestKeyboardProperty = useCallback((property: CardEditableProperty) => {
    const active = resolveHighlightedCard();
    if (!active) return false;
    if (property === "tags" && tagsProperty) {
      propertyOptionRegistries.requestOptions(tagsProperty);
    }
    setKeyboardPropertyRequest((current) => ({
      requestId: (current?.requestId ?? 0) + 1,
      pageId: active.card.id,
      property,
    }));
    return true;
  }, [propertyOptionRegistries, resolveHighlightedCard, tagsProperty]);

  const handleBoardPeek = useCallback((phase: "keydown" | "keyup") => {
    const active = resolveHighlightedCard();
    if (!active) return false;
    if (phase === "keydown") {
      if (peekPressRef.current?.pageId === active.card.id) return true;
      peekPressRef.current = {
        pageId: active.card.id,
        startedAt: performance.now(),
        wasOpen: pageStagePageId === active.card.id,
      };
      if (pageStagePageId !== active.card.id) {
        void openPageStageFromCard(active.card, "preview");
      }
      return true;
    }

    const press = peekPressRef.current;
    peekPressRef.current = null;
    if (!press || press.pageId !== active.card.id) return false;
    const held = performance.now() - press.startedAt >= BOARD_CARD_PEEK_HOLD_DELAY_MS;
    if ((held && !press.wasOpen) || (!held && press.wasOpen)) {
      void pageStageCloseRef?.current?.();
    }
    return true;
  }, [openPageStageFromCard, pageStageCloseRef, pageStagePageId, resolveHighlightedCard]);

  const moveHighlightedCards = useCallback((commandId: CommandId) => {
    if (!board || !filteredBoard) return false;
    const active = resolveHighlightedCard();
    if (!active) return false;

    const draggedPageIds = resolveBoardKeyboardActionPageIds(
      filteredBoard,
      active.card.id,
      selectedPageIds,
    );
    const dragItems = filteredBoard.columns.flatMap((column) =>
      column.cards
        .filter((card) => draggedPageIds.includes(card.id))
        .map((card) => ({ card, columnId: column.id })),
    );
    if (dragItems.length === 0) return false;

    const activeColumn = filteredBoard.columns[active.location.columnIndex];
    if (!activeColumn) return false;
    const vertical = commandId === "boardMoveUp"
      || commandId === "boardMoveDown"
      || commandId === "boardMoveTop"
      || commandId === "boardMoveBottom";
    if (
      vertical
      && dragItems.some((entry) => entry.columnId !== activeColumn.id)
    ) return false;

    let destinationColumnId = activeColumn.id;
    let destinationIndex = active.location.cardIndex;
    if (commandId === "boardMoveLeft" || commandId === "boardMoveRight") {
      const offset = commandId === "boardMoveRight" ? 1 : -1;
      const destinationColumn = filteredBoard.columns[active.location.columnIndex + offset];
      if (!destinationColumn) return false;
      destinationColumnId = destinationColumn.id;
      destinationIndex = Math.min(active.location.cardIndex, destinationColumn.cards.length);
    } else {
      const indices = dragItems.map((entry) =>
        activeColumn.cards.findIndex((card) => card.id === entry.card.id),
      ).filter((index) => index >= 0);
      if (indices.length === 0) return false;
      const first = Math.min(...indices);
      const last = Math.max(...indices);
      if (commandId === "boardMoveUp") destinationIndex = Math.max(0, first - 1);
      if (commandId === "boardMoveDown") {
        destinationIndex = Math.min(activeColumn.cards.length, last + 2);
      }
      if (commandId === "boardMoveTop") destinationIndex = 0;
      if (commandId === "boardMoveBottom") destinationIndex = activeColumn.cards.length;
      if (destinationIndex === first && commandId !== "boardMoveBottom") return false;
    }

    const intent = resolveBoardCardDropIntent({
      board,
      visibleBoard: filteredBoard,
      rules: viewPrefs.rules,
      destinationColumnId,
      destinationIndex,
      dragItems,
    });
    if (intent.kind === "blocked") {
      toast.info(intent.message, { id: "board-keyboard-move-blocked" });
      return true;
    }
    const newOrder = intent.kind === "reorder" || intent.kind === "reorder-with-patch"
      ? intent.newOrder
      : undefined;
    const fieldPatch = intent.kind === "reorder-with-patch"
      ? intent.fieldPatch
      : undefined;
    const sharedSource = dragItems.every((entry) => entry.columnId === dragItems[0]?.columnId)
      ? dragItems[0]?.columnId
      : undefined;

    if (dragItems.length === 1) {
      const entry = dragItems[0]!;
      void movePage({
        pageId: entry.card.id,
        fromStatus: entry.columnId,
        toStatus: destinationColumnId,
        ...(typeof newOrder === "number" ? { newOrder } : {}),
        ...(fieldPatch ? { fieldPatch } : {}),
      });
      return true;
    }
    void movePages({
      pageIds: dragItems.map((entry) => entry.card.id),
      ...(sharedSource ? { fromStatus: sharedSource } : {}),
      toStatus: destinationColumnId,
      ...(typeof newOrder === "number" ? { newOrder } : {}),
      ...(fieldPatch ? { fieldPatch } : {}),
    });
    return true;
  }, [
    board,
    filteredBoard,
    movePage,
    movePages,
    resolveHighlightedCard,
    selectedPageIds,
    viewPrefs.rules,
  ]);

  useContextualKeyboardActionTarget({
    surfaceId,
    presentationId: panelTabId,
    canExecute: (commandId: CommandId): boolean => {
      const hasCards = Boolean(filteredBoard?.columns.some((column) => column.cards.length > 0));
      if (
        commandId === "boardFocusNext"
        || commandId === "boardFocusPrevious"
        || commandId === "boardFocusLeft"
        || commandId === "boardFocusRight"
      ) return hasCards;
      if (commandId === "boardClearSelection") {
        return selectedPageIds.size > 0 || Boolean(pageStagePageId);
      }
      if (commandId === "workOnPage") {
        return Boolean(resolveHighlightedCard() && onOpenPageInNewChat);
      }
      if (commandId === "boardSetTags") {
        return Boolean(resolveHighlightedCard() && tagsProperty);
      }
      if (commandId === "boardSetPriority") {
        return Boolean(resolveHighlightedCard() && propertyCapabilities.priorityProperty);
      }
      if (commandId === "boardSetEstimate") {
        return Boolean(resolveHighlightedCard() && propertyCapabilities.estimateProperty);
      }
      if (commandId === "boardSetStatus") return Boolean(resolveHighlightedCard());
      if (commandId.startsWith("boardMove")) {
        return Boolean(resolveHighlightedCard() && databaseView?.readOnlyReason === null);
      }
      return commandId === "boardPeek"
        || commandId === "boardOpen"
        || commandId === "boardToggleSelection"
        ? Boolean(resolveHighlightedCard())
        : false;
    },
    execute: (commandId: CommandId, phase: "keydown" | "keyup"): boolean => {
      if (commandId === "boardFocusNext") return navigateBoardHighlight("next");
      if (commandId === "boardFocusPrevious") return navigateBoardHighlight("previous");
      if (commandId === "boardFocusLeft") return navigateBoardHighlight("left");
      if (commandId === "boardFocusRight") return navigateBoardHighlight("right");
      if (commandId === "boardPeek") return handleBoardPeek(phase);
      if (commandId === "boardClearSelection") {
        if (selectedPageIds.size > 0) {
          setCardSelection(emptyCardSelection());
        } else {
          void pageStageCloseRef?.current?.();
        }
        return true;
      }
      const active = resolveHighlightedCard();
      if (!active) return false;
      if (commandId === "boardOpen") {
        void openPageStageFromCard(active.card, "durable");
        return true;
      }
      if (commandId === "boardToggleSelection") {
        setCardSelection((current) => toggleCardSelection(current, active.card.id));
        return true;
      }
      if (commandId === "boardSetStatus") return requestKeyboardProperty("status");
      if (commandId === "boardSetPriority") return requestKeyboardProperty("priority");
      if (commandId === "boardSetEstimate") return requestKeyboardProperty("estimate");
      if (commandId === "boardSetTags") return requestKeyboardProperty("tags");
      if (commandId === "workOnPage" && onOpenPageInNewChat) {
        void onOpenPageInNewChat({
          projectId,
          pageId: active.card.id,
          titleSnapshot: active.card.title,
        });
        return true;
      }
      if (commandId.startsWith("boardMove")) {
        return moveHighlightedCards(commandId);
      }
      return false;
    },
  });

  const updateColumnLayout = useCallback((
    columnId: WorkflowStatus,
    patch: { collapsed?: boolean; width?: number },
  ) => {
    setColumnLayoutPrefs((current) => {
      const next = updateBoardColumnLayoutPrefs(current, columnId, patch);
      writeBoardColumnLayoutPrefs(projectId, next);
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

  const createDisabledReason = databaseView?.readOnlyReason === null
    ? null
    : databaseView?.readOnlyReason
      ?? "The selected Database View is read-only";

  return (
    <div
      ref={boardRootRef}
      className="flex h-full min-h-0 flex-col"
      data-board-root
      data-board-surface-id={surfaceId}
      tabIndex={-1}
      onFocusCapture={() => {
        markPageCreateTargetActive(appHandle, surfaceId);
        markContextualKeyboardActionTargetActive(surfaceId);
      }}
      onPointerDownCapture={() => {
        markPageCreateTargetActive(appHandle, surfaceId);
        markContextualKeyboardActionTargetActive(surfaceId);
      }}
    >
      <BoardScrollContainer ref={boardScrollContainerRef} scrollStateKey={scrollStateKey}>
        {/* Board container - Notion-style scroll with sticky headers */}
        <div className="flex w-max min-w-full px-4">
          {filteredBoard.columns.map((column) => (
            <Column
              projectId={projectId}
              projectName={currentProject?.name ?? projectId}
              key={column.id}
              column={column}
              pagination={groupPagination.get(groupScopeKeyForColumn(column.id))
                ?? groupPagination.get(UNGROUPED_SCOPE_KEY)}
              onLoadMore={loadMoreGroup}
              displayPrefs={viewPrefs.display}
              showPageKey={showPageKey}
              dragInstanceId={dragInstanceId}
              buildDragData={buildDragData}
              layout={getBoardColumnLayout(columnLayoutPrefs, column.id)}
              onRequestCreatePage={handleRequestCreatePage}
              createDisabledReason={createDisabledReason}
              onEditCard={handleEditCard}
              onUpdatePageProperty={handleUpdatePageProperty}
              onCollapsedChange={(columnId, collapsed) => updateColumnLayout(columnId, { collapsed })}
              onWidthChange={(columnId, width) => updateColumnLayout(columnId, { width })}
              onDeletePageFromMenu={handleDeletePageFromMenu}
              onCopyCardLinkFromMenu={handleCopyCardLinkFromMenu}
              onCopyPageKeyFromMenu={handleCopyPageKeyFromMenu}
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
              presentedPageIds={boardPresentedPageIds}
              selectedPageIds={selectedPageIds}
              highlightedPageId={highlightedPageId}
              keyboardPropertyRequest={keyboardPropertyRequest}
              tagOptions={tagOptions}
              onCardHighlight={(pageId) => highlightCard(pageId)}
              onExternalBlockDragOver={handleExternalBlockDragOver}
              onExternalBlockDragLeave={handleExternalBlockDragLeave}
              onExternalBlockDrop={(columnId, event) => {
                void handleExternalBlockDrop(columnId, event);
              }}
            />
          ))}
        </div>
      </BoardScrollContainer>
    </div>
  );
}
