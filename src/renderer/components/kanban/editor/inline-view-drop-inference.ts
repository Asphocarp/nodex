import type { PageInput, BoardSummary, DatabasePageSummary, Estimate, Priority } from "../../../lib/types";
import type { ToggleListSettings, ToggleListStatusId } from "../../../lib/toggle-list/types";
import {
  deriveToggleListFilterRule,
  toggleListSortIncludesField,
} from "../../../lib/toggle-list/settings";
import { TOGGLE_LIST_STATUS_ORDER } from "../../../lib/toggle-list/types";

export interface InlineViewProjectedRow {
  blockId: string;
  pageId: string;
  sourceStatus?: ToggleListStatusId;
}

export interface InferInlineViewDropImportInput {
  settings: ToggleListSettings;
  projectedRows: InlineViewProjectedRow[];
  insertRowIndex: number;
  board: BoardSummary;
  cards: PageInput[];
}

export interface InferInlineViewDropImportResult {
  targetStatus: ToggleListStatusId;
  insertIndex?: number;
  cards: PageInput[];
}

type CardWithColumn = DatabasePageSummary & {
  columnId: ToggleListStatusId;
};

function clampInsertRowIndex(
  index: number,
  total: number,
): number {
  if (!Number.isFinite(index)) return total;
  if (index <= 0) return 0;
  if (index >= total) return total;
  return Math.trunc(index);
}

function buildCardById(board: BoardSummary): Map<string, CardWithColumn> {
  const byId = new Map<string, CardWithColumn>();

  for (const column of board.columns) {
    if (!TOGGLE_LIST_STATUS_ORDER.includes(column.id as ToggleListStatusId)) continue;

    const columnId = column.id as ToggleListStatusId;
    for (const card of column.cards) {
      byId.set(card.id, {
        ...card,
        columnId,
      });
    }
  }

  return byId;
}

function resolveFallbackStatus(settings: ToggleListSettings): ToggleListStatusId {
  const firstAllowed = deriveToggleListFilterRule(settings.rulesV2).statuses[0];
  if (firstAllowed && TOGGLE_LIST_STATUS_ORDER.includes(firstAllowed)) {
    return firstAllowed;
  }
  return TOGGLE_LIST_STATUS_ORDER[0];
}

function resolveInsertIndexForColumn(
  board: BoardSummary,
  targetStatus: ToggleListStatusId,
  afterPageId?: string,
  beforePageId?: string,
): number | undefined {
  const targetColumn = board.columns.find((column) => column.id === targetStatus);
  if (!targetColumn) return undefined;

  if (afterPageId) {
    const beforeIndex = targetColumn.cards.findIndex((card) => card.id === afterPageId);
    if (beforeIndex >= 0) return beforeIndex;
  }

  if (beforePageId) {
    const afterIndex = targetColumn.cards.findIndex((card) => card.id === beforePageId);
    if (afterIndex >= 0) return afterIndex + 1;
  }

  return undefined;
}

function inferPriorityDefault(
  input: PageInput,
  referenceCard: CardWithColumn | undefined,
  settings: ToggleListSettings,
): Priority | null | undefined {
  if (Object.prototype.hasOwnProperty.call(input, "priority")) {
    return input.priority;
  }

  const rankIncludesPriority = toggleListSortIncludesField(settings.rulesV2, "priority");
  if (rankIncludesPriority && referenceCard) {
    return referenceCard.priority ?? null;
  }

  const filterRule = deriveToggleListFilterRule(settings.rulesV2);
  const priorities = filterRule.priorities;
  if (priorities.length === 1) {
    return priorities[0];
  }
  if (priorities.length === 0 && filterRule.includeEmptyPriority) {
    return null;
  }

  return undefined;
}

function inferEstimateDefault(
  input: PageInput,
  referenceCard: CardWithColumn | undefined,
  settings: ToggleListSettings,
): Estimate | null | undefined {
  if (Object.prototype.hasOwnProperty.call(input, "estimate")) return input.estimate;

  const rankIncludesEstimate = toggleListSortIncludesField(settings.rulesV2, "estimate");
  if (!rankIncludesEstimate) return undefined;
  if (!referenceCard) return undefined;

  return referenceCard.estimate ?? null;
}

export function inferInlineViewDropImport(
  input: InferInlineViewDropImportInput,
): InferInlineViewDropImportResult {
  const cardById = buildCardById(input.board);
  const insertRowIndex = clampInsertRowIndex(input.insertRowIndex, input.projectedRows.length);
  const beforeRow = insertRowIndex > 0
    ? input.projectedRows[insertRowIndex - 1]
    : undefined;
  const afterRow = insertRowIndex < input.projectedRows.length
    ? input.projectedRows[insertRowIndex]
    : undefined;

  const beforeCard = beforeRow ? cardById.get(beforeRow.pageId) : undefined;
  const afterCard = afterRow ? cardById.get(afterRow.pageId) : undefined;
  const targetStatus = afterCard?.columnId
    ?? beforeCard?.columnId
    ?? afterRow?.sourceStatus
    ?? beforeRow?.sourceStatus
    ?? resolveFallbackStatus(input.settings);
  const insertIndex = resolveInsertIndexForColumn(
    input.board,
    targetStatus,
    afterCard?.id,
    beforeCard?.id,
  );
  const referenceCard = afterCard ?? beforeCard;

  const cards = input.cards.map((card) => {
    const priority = inferPriorityDefault(card, referenceCard, input.settings);
    const estimate = inferEstimateDefault(card, referenceCard, input.settings);

    return {
      ...card,
      ...(priority !== undefined ? { priority } : {}),
      ...(estimate !== undefined ? { estimate } : {}),
    };
  });

  return {
    targetStatus,
    ...(insertIndex !== undefined ? { insertIndex } : {}),
    cards,
  };
}
