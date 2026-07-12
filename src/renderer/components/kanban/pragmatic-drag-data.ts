import type { BoardSummary, CardSummary, CardStatus } from "@/lib/types";
import { resolveDragGroup, type CardSelectionState } from "./card-selection";

export interface KanbanCardDragItem {
  card: CardSummary;
  columnId: CardStatus;
  columnName: string;
}

export interface KanbanCardDragData extends Record<string | symbol, unknown> {
  type: "kanban-card";
  instanceId: symbol;
  projectId: string;
  sourceCardId: string;
  sourceColumnId: CardStatus;
  sourceCard: CardSummary;
  dragItems: KanbanCardDragItem[];
}

export interface KanbanCardDropTargetData extends Record<string | symbol, unknown> {
  type: "kanban-card";
  instanceId: symbol;
  cardId: string;
  columnId: CardStatus;
}

export interface KanbanColumnDropTargetData extends Record<string | symbol, unknown> {
  type: "kanban-column";
  instanceId: symbol;
  columnId: CardStatus;
}

export interface KanbanCardReferenceEditorDropTargetData
  extends Record<string | symbol, unknown> {
  type: "kanban-card-reference-editor";
}

export function buildKanbanCardDragData(args: {
  board: BoardSummary | null;
  selection: CardSelectionState;
  instanceId: symbol;
  projectId: string;
  activeCard: CardSummary;
  columnId: CardStatus;
}): KanbanCardDragData {
  const dragItems = resolveDragGroup(args.board, args.selection, {
    card: args.activeCard,
    columnId: args.columnId,
  }).map((entry) => ({
    ...entry,
    columnId: entry.columnId as CardStatus,
  }));

  return {
    type: "kanban-card",
    instanceId: args.instanceId,
    projectId: args.projectId,
    sourceCardId: args.activeCard.id,
    sourceColumnId: args.columnId,
    sourceCard: args.activeCard,
    dragItems,
  };
}

export function buildKanbanCardDropTargetData(args: {
  instanceId: symbol;
  cardId: string;
  columnId: CardStatus;
}): KanbanCardDropTargetData {
  return {
    type: "kanban-card",
    instanceId: args.instanceId,
    cardId: args.cardId,
    columnId: args.columnId,
  };
}

export function buildKanbanColumnDropTargetData(args: {
  instanceId: symbol;
  columnId: CardStatus;
}): KanbanColumnDropTargetData {
  return {
    type: "kanban-column",
    instanceId: args.instanceId,
    columnId: args.columnId,
  };
}

export function buildKanbanCardReferenceEditorDropTargetData(): KanbanCardReferenceEditorDropTargetData {
  return { type: "kanban-card-reference-editor" };
}

export function isKanbanCardDragData(value: unknown): value is KanbanCardDragData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KanbanCardDragData>;
  return candidate.type === "kanban-card"
    && typeof candidate.projectId === "string"
    && typeof candidate.sourceCardId === "string"
    && typeof candidate.sourceColumnId === "string"
    && typeof candidate.instanceId === "symbol"
    && Array.isArray(candidate.dragItems);
}

export function canDropOnKanbanCard(args: {
  targetCardId: string;
  source: unknown;
  instanceId: symbol;
}): boolean {
  if (!isKanbanCardDragData(args.source)) {
    return false;
  }

  if (args.source.instanceId !== args.instanceId) {
    return false;
  }

  return !args.source.dragItems.some((entry) => entry.card.id === args.targetCardId);
}

export function isKanbanCardDropTargetData(
  value: unknown,
): value is KanbanCardDropTargetData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KanbanCardDropTargetData>;
  return candidate.type === "kanban-card"
    && typeof candidate.cardId === "string"
    && typeof candidate.columnId === "string"
    && typeof candidate.instanceId === "symbol";
}

export function isKanbanColumnDropTargetData(
  value: unknown,
): value is KanbanColumnDropTargetData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KanbanColumnDropTargetData>;
  return candidate.type === "kanban-column"
    && typeof candidate.columnId === "string"
    && typeof candidate.instanceId === "symbol";
}

export function isKanbanCardReferenceEditorDropTargetData(
  value: unknown,
): value is KanbanCardReferenceEditorDropTargetData {
  if (!value || typeof value !== "object") return false;
  return (value as Partial<KanbanCardReferenceEditorDropTargetData>).type
    === "kanban-card-reference-editor";
}
