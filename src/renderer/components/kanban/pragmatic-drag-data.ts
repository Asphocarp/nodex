import type { BoardSummary, DatabasePageSummary, WorkflowStatus } from "@/lib/types";
import { resolveDragGroup, type CardSelectionState } from "./card-selection";

export interface KanbanCardDragItem {
  card: DatabasePageSummary;
  columnId: WorkflowStatus;
  columnName: string;
}

export interface KanbanCardDragData extends Record<string | symbol, unknown> {
  type: "kanban-card";
  instanceId: symbol;
  projectId: string;
  databaseBlockId: string;
  dataSourceId: string;
  storeEpoch: string;
  sourcePageId: string;
  sourceColumnId: WorkflowStatus;
  sourcePage: DatabasePageSummary;
  dragItems: KanbanCardDragItem[];
}

export interface KanbanCardDropTargetData extends Record<string | symbol, unknown> {
  type: "kanban-card";
  instanceId: symbol;
  pageId: string;
  columnId: WorkflowStatus;
}

export interface KanbanColumnDropTargetData extends Record<string | symbol, unknown> {
  type: "kanban-column";
  instanceId: symbol;
  columnId: WorkflowStatus;
}

export interface KanbanCardEditorTransferTargetData
  extends Record<string | symbol, unknown> {
  type: "kanban-card-editor-transfer";
}

export function buildKanbanCardDragData(args: {
  board: BoardSummary | null;
  selection: CardSelectionState;
  instanceId: symbol;
  projectId: string;
  databaseBlockId: string;
  dataSourceId: string;
  storeEpoch: string;
  activePage: DatabasePageSummary;
  columnId: WorkflowStatus;
}): KanbanCardDragData {
  const dragItems = resolveDragGroup(args.board, args.selection, {
    card: args.activePage,
    columnId: args.columnId,
  }).map((entry) => ({
    ...entry,
    columnId: entry.columnId as WorkflowStatus,
  }));

  return {
    type: "kanban-card",
    instanceId: args.instanceId,
    projectId: args.projectId,
    databaseBlockId: args.databaseBlockId,
    dataSourceId: args.dataSourceId,
    storeEpoch: args.storeEpoch,
    sourcePageId: args.activePage.id,
    sourceColumnId: args.columnId,
    sourcePage: args.activePage,
    dragItems,
  };
}

export function buildKanbanCardDropTargetData(args: {
  instanceId: symbol;
  pageId: string;
  columnId: WorkflowStatus;
}): KanbanCardDropTargetData {
  return {
    type: "kanban-card",
    instanceId: args.instanceId,
    pageId: args.pageId,
    columnId: args.columnId,
  };
}

export function buildKanbanColumnDropTargetData(args: {
  instanceId: symbol;
  columnId: WorkflowStatus;
}): KanbanColumnDropTargetData {
  return {
    type: "kanban-column",
    instanceId: args.instanceId,
    columnId: args.columnId,
  };
}

export function buildKanbanCardEditorTransferTargetData(): KanbanCardEditorTransferTargetData {
  return { type: "kanban-card-editor-transfer" };
}

export function isKanbanCardDragData(value: unknown): value is KanbanCardDragData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KanbanCardDragData>;
  return candidate.type === "kanban-card"
    && typeof candidate.projectId === "string"
    && typeof candidate.databaseBlockId === "string"
    && typeof candidate.dataSourceId === "string"
    && typeof candidate.storeEpoch === "string"
    && typeof candidate.sourcePageId === "string"
    && typeof candidate.sourceColumnId === "string"
    && typeof candidate.instanceId === "symbol"
    && Array.isArray(candidate.dragItems);
}

export function canDropOnKanbanCard(args: {
  targetPageId: string;
  source: unknown;
  instanceId: symbol;
}): boolean {
  if (!isKanbanCardDragData(args.source)) {
    return false;
  }

  if (args.source.instanceId !== args.instanceId) {
    return false;
  }

  return !args.source.dragItems.some((entry) => entry.card.id === args.targetPageId);
}

export function isKanbanCardDropTargetData(
  value: unknown,
): value is KanbanCardDropTargetData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KanbanCardDropTargetData>;
  return candidate.type === "kanban-card"
    && typeof candidate.pageId === "string"
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

export function isKanbanCardEditorTransferTargetData(
  value: unknown,
): value is KanbanCardEditorTransferTargetData {
  if (!value || typeof value !== "object") return false;
  return (value as Partial<KanbanCardEditorTransferTargetData>).type
    === "kanban-card-editor-transfer";
}
