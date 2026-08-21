import type { BoardSummary, DatabasePageSummary, WorkflowStatus } from "@/lib/types";
import { resolveDragGroup, type CardSelectionState } from "./card-selection";

export interface BoardCardDragItem {
  card: DatabasePageSummary;
  columnId: WorkflowStatus;
  columnName: string;
}

export interface BoardCardDragData extends Record<string | symbol, unknown> {
  type: "board-card";
  instanceId: symbol;
  projectId: string;
  databaseBlockId: string;
  dataSourceId: string;
  storeEpoch: string;
  sourcePageId: string;
  sourceColumnId: WorkflowStatus;
  sourcePage: DatabasePageSummary;
  dragItems: BoardCardDragItem[];
}

export interface BoardCardDropTargetData extends Record<string | symbol, unknown> {
  type: "board-card";
  instanceId: symbol;
  pageId: string;
  columnId: WorkflowStatus;
}

export interface BoardColumnDropTargetData extends Record<string | symbol, unknown> {
  type: "board-column";
  instanceId: symbol;
  columnId: WorkflowStatus;
}

export interface BoardCardEditorTransferTargetData extends Record<string | symbol, unknown> {
  type: "board-card-editor-transfer";
}

export function buildBoardCardDragData(args: {
  board: BoardSummary | null;
  selection: CardSelectionState;
  instanceId: symbol;
  projectId: string;
  databaseBlockId: string;
  dataSourceId: string;
  storeEpoch: string;
  activePage: DatabasePageSummary;
  columnId: WorkflowStatus;
}): BoardCardDragData {
  const dragItems = resolveDragGroup(args.board, args.selection, {
    card: args.activePage,
    columnId: args.columnId,
  }).map((entry) => ({
    ...entry,
    columnId: entry.columnId as WorkflowStatus,
  }));

  return {
    type: "board-card",
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

export function buildBoardCardDropTargetData(args: {
  instanceId: symbol;
  pageId: string;
  columnId: WorkflowStatus;
}): BoardCardDropTargetData {
  return {
    type: "board-card",
    instanceId: args.instanceId,
    pageId: args.pageId,
    columnId: args.columnId,
  };
}

export function buildBoardColumnDropTargetData(args: {
  instanceId: symbol;
  columnId: WorkflowStatus;
}): BoardColumnDropTargetData {
  return {
    type: "board-column",
    instanceId: args.instanceId,
    columnId: args.columnId,
  };
}

export function buildBoardCardEditorTransferTargetData(): BoardCardEditorTransferTargetData {
  return { type: "board-card-editor-transfer" };
}

export function isBoardCardDragData(value: unknown): value is BoardCardDragData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BoardCardDragData>;
  return (
    candidate.type === "board-card" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.databaseBlockId === "string" &&
    typeof candidate.dataSourceId === "string" &&
    typeof candidate.storeEpoch === "string" &&
    typeof candidate.sourcePageId === "string" &&
    typeof candidate.sourceColumnId === "string" &&
    typeof candidate.instanceId === "symbol" &&
    Array.isArray(candidate.dragItems)
  );
}

export function canDropOnBoardCard(args: {
  targetPageId: string;
  source: unknown;
  instanceId: symbol;
}): boolean {
  if (!isBoardCardDragData(args.source)) {
    return false;
  }

  if (args.source.instanceId !== args.instanceId) {
    return false;
  }

  return !args.source.dragItems.some((entry) => entry.card.id === args.targetPageId);
}

export function isBoardCardDropTargetData(value: unknown): value is BoardCardDropTargetData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BoardCardDropTargetData>;
  return (
    candidate.type === "board-card" &&
    typeof candidate.pageId === "string" &&
    typeof candidate.columnId === "string" &&
    typeof candidate.instanceId === "symbol"
  );
}

export function isBoardColumnDropTargetData(value: unknown): value is BoardColumnDropTargetData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BoardColumnDropTargetData>;
  return (
    candidate.type === "board-column" &&
    typeof candidate.columnId === "string" &&
    typeof candidate.instanceId === "symbol"
  );
}

export function isBoardCardEditorTransferTargetData(
  value: unknown,
): value is BoardCardEditorTransferTargetData {
  if (!value || typeof value !== "object") return false;
  return (
    (value as Partial<BoardCardEditorTransferTargetData>).type === "board-card-editor-transfer"
  );
}
