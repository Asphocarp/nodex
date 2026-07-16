import type { BoardSummary, DatabasePageSummary, WorkflowStatus, MovePageInput } from "@/lib/types";
import type { DbViewRules, DbViewSortField } from "../../lib/db-view-prefs";
import { DB_VIEW_SORT_FIELD_LABELS } from "../../lib/db-view-prefs";
import { resolveFilteredDropOrder } from "./filtered-drag-order";

interface DragItemLike {
  columnId: string;
  card: Pick<DatabasePageSummary, "id" | "priority" | "estimate">;
}

type MoveFieldPatch = NonNullable<MovePageInput["fieldPatch"]>;
type MoveFieldPatchField = keyof MoveFieldPatch;

export type KanbanCardDragMode =
  | { kind: "manual-rank" }
  | { kind: "property-sorted"; field: MoveFieldPatchField }
  | { kind: "derived-move-only"; field: DbViewSortField };

export type KanbanCardDropIntent =
  | {
      kind: "reorder";
      columnId: WorkflowStatus;
      newOrder: number;
    }
  | {
      kind: "reorder-with-patch";
      columnId: WorkflowStatus;
      newOrder: number;
      fieldPatch: MoveFieldPatch;
      previewLabel: string;
    }
  | {
      kind: "move-only";
      columnId: WorkflowStatus;
    }
  | {
      kind: "blocked";
      columnId: WorkflowStatus;
      message: string;
    };

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getPrimarySortField(rules: DbViewRules): DbViewSortField {
  return rules.sort[0]?.field ?? "board-order";
}

function resolveSortBucketValue(card: Pick<DatabasePageSummary, "priority" | "estimate"> | undefined, field: MoveFieldPatchField) {
  if (!card) return null;
  return field === "priority"
    ? (card.priority ?? null)
    : (card.estimate ?? null);
}

function buildPreviewLabel(field: MoveFieldPatchField, value: DatabasePageSummary["priority"] | DatabasePageSummary["estimate"] | null): string {
  if (field === "priority") {
    const label = value === null
      ? "Empty"
      : value === "p0-critical"
        ? "P0"
        : value === "p1-high"
          ? "P1"
          : value === "p2-medium"
            ? "P2"
            : value === "p3-low"
              ? "P3"
              : "P4";
    return `Priority: ${label}`;
  }

  const label = typeof value === "string" ? value.toUpperCase() : "Empty";
  return `Estimate: ${label}`;
}

export function resolveKanbanCardDragMode(args: {
  rules: DbViewRules;
}): KanbanCardDragMode {
  const primarySortField = getPrimarySortField(args.rules);
  if (primarySortField === "board-order") {
    return { kind: "manual-rank" };
  }

  if (primarySortField === "priority" || primarySortField === "estimate") {
    return {
      kind: "property-sorted",
      field: primarySortField,
    };
  }

  return {
    kind: "derived-move-only",
    field: primarySortField,
  };
}

export function resolveKanbanCardDropIntent(args: {
  board: BoardSummary | null;
  visibleBoard: BoardSummary | null;
  rules: DbViewRules;
  destinationColumnId: WorkflowStatus;
  destinationIndex: number;
  dragItems: readonly DragItemLike[];
}): KanbanCardDropIntent {
  const dragMode = resolveKanbanCardDragMode({ rules: args.rules });
  const draggedPageIds = args.dragItems.map((entry) => entry.card.id);

  if (dragMode.kind === "manual-rank") {
    return {
      kind: "reorder",
      columnId: args.destinationColumnId,
      newOrder: resolveFilteredDropOrder({
        board: args.board,
        visibleBoard: args.visibleBoard,
        draggedPageIds,
        targetColumnId: args.destinationColumnId,
        targetVisibleIndex: args.destinationIndex,
      }),
    };
  }

  if (dragMode.kind === "derived-move-only") {
    const hasCrossColumnMove = args.dragItems.some((entry) => entry.columnId !== args.destinationColumnId);
    if (hasCrossColumnMove) {
      return {
        kind: "move-only",
        columnId: args.destinationColumnId,
      };
    }

    return {
      kind: "blocked",
      columnId: args.destinationColumnId,
      message: `Sorted by ${DB_VIEW_SORT_FIELD_LABELS[dragMode.field]}; switch to Board Order to manually rank.`,
    };
  }

  if (!args.board || !args.visibleBoard) {
    return {
      kind: "move-only",
      columnId: args.destinationColumnId,
    };
  }

  const targetColumn = args.visibleBoard.columns.find((column) => column.id === args.destinationColumnId);
  const visibleCards = targetColumn?.cards ?? [];
  const visibleIndex = clamp(args.destinationIndex, 0, visibleCards.length);
  if (visibleCards.length === 0) {
    return {
      kind: "reorder",
      columnId: args.destinationColumnId,
      newOrder: resolveFilteredDropOrder({
        board: args.board,
        visibleBoard: args.visibleBoard,
        draggedPageIds,
        targetColumnId: args.destinationColumnId,
        targetVisibleIndex: visibleIndex,
      }),
    };
  }

  const beforeCard = visibleIndex > 0 ? visibleCards[visibleIndex - 1] : undefined;
  const afterCard = visibleIndex < visibleCards.length ? visibleCards[visibleIndex] : undefined;
  const beforeValue = resolveSortBucketValue(beforeCard, dragMode.field);
  const afterValue = resolveSortBucketValue(afterCard, dragMode.field);

  const targetValue = beforeCard && afterCard && beforeValue === afterValue
    ? beforeValue
    : afterCard
      ? afterValue
      : beforeValue;

  const newOrder = resolveFilteredDropOrder({
    board: args.board,
    visibleBoard: args.visibleBoard,
    draggedPageIds,
    targetColumnId: args.destinationColumnId,
    targetVisibleIndex: visibleIndex,
  });

  const needsPatch = args.dragItems.some(
    (entry) => resolveSortBucketValue(entry.card, dragMode.field) !== targetValue,
  );
  if (!needsPatch) {
    return {
      kind: "reorder",
      columnId: args.destinationColumnId,
      newOrder,
    };
  }

  return {
    kind: "reorder-with-patch",
    columnId: args.destinationColumnId,
    newOrder,
    fieldPatch: {
      [dragMode.field]: targetValue,
    },
    previewLabel: buildPreviewLabel(dragMode.field, targetValue),
  };
}
