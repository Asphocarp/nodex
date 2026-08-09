import type {
  BoardSummary,
  DatabasePageSummary,
  PageCreateInput,
  PageCreatePlacement,
  PageInput,
  MovePageInput,
  MovePagesInput,
} from "./types";
import { DEFAULT_WORKFLOW_STATUS } from "../../shared/workflow-status";
import { pageInputToSummaryPatch, summarizePageDescription } from "../../shared/page-summary";
import { plainTextToPortableRichText } from "../../shared/block-documents/portable-rich-text";

/**
 * An optimistic transform is replayed over the latest canonical Board while
 * its mutation is pending. It must therefore be pure and converge by stable
 * Page identity when authority has already applied the same effect.
 */
export type BoardTransform = (board: BoardSummary) => BoardSummary;

interface PatchTransformOptions {
  bumpRevision?: boolean;
}

const isPlainRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const patchValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date &&
      right instanceof Date &&
      left.getTime() === right.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((value, index) =>
      patchValuesEqual(value, right[index])
    );
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) =>
    Object.hasOwn(right, key) && patchValuesEqual(left[key], right[key])
  );
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizePatch(updates: Partial<PageInput>): Partial<DatabasePageSummary> {
  return pageInputToSummaryPatch(updates);
}

function findCardLocation(
  board: BoardSummary,
  pageId: string,
  preferredColumnId?: string,
): { columnIndex: number; pageIndex: number } | null {
  if (preferredColumnId) {
    const preferredColumnIndex = board.columns.findIndex((column) => column.id === preferredColumnId);
    if (preferredColumnIndex >= 0) {
      const preferredCardIndex = board.columns[preferredColumnIndex]?.cards.findIndex((card) => card.id === pageId) ?? -1;
      if (preferredCardIndex >= 0) {
        return { columnIndex: preferredColumnIndex, pageIndex: preferredCardIndex };
      }
    }
  }

  for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex += 1) {
    const pageIndex = board.columns[columnIndex]?.cards.findIndex((card) => card.id === pageId) ?? -1;
    if (pageIndex >= 0) return { columnIndex, pageIndex };
  }

  return null;
}

function reindexCards(cards: DatabasePageSummary[]): DatabasePageSummary[] {
  let changed = false;
  const next = cards.map((card, index) => {
    if (card.order === index) return card;
    changed = true;
    return {
      ...card,
      order: index,
    };
  });
  return changed ? next : cards;
}

function replaceColumnCards(
  board: BoardSummary,
  columnIndex: number,
  nextCards: DatabasePageSummary[],
): BoardSummary {
  const column = board.columns[columnIndex];
  if (!column) return board;

  const withOrder = reindexCards(nextCards);
  if (column.cards === withOrder) return board;

  const nextColumns = [...board.columns];
  nextColumns[columnIndex] = {
    ...column,
    cards: withOrder,
  };

  return {
    ...board,
    columns: nextColumns,
  };
}

function insertNewCardIntoColumn(
  board: BoardSummary,
  columnId: string,
  card: DatabasePageSummary,
  placement: PageCreatePlacement,
  insertIndex?: number,
): BoardSummary {
  // The LocalCommit projection can arrive before the initiating mutation
  // Promise settles. Once authority contains this Page, the create overlay is
  // converged: preserve the canonical fields and placement instead of
  // projecting a second occurrence of the same identity.
  if (findCardLocation(board, card.id)) return board;

  const columnIndex = board.columns.findIndex((column) => column.id === columnId);
  if (columnIndex < 0) return board;

  const column = board.columns[columnIndex];
  if (!column) return board;

  const nextCards = [...column.cards];
  const beforeCardIndex = typeof placement === "object"
    ? nextCards.findIndex((candidate) => candidate.id === placement.beforePageId)
    : -1;
  const index = insertIndex !== undefined
    ? clamp(insertIndex, 0, nextCards.length)
    : placement === "top"
      ? 0
      : beforeCardIndex >= 0
        ? beforeCardIndex
        : nextCards.length;
  nextCards.splice(index, 0, card);
  return replaceColumnCards(board, columnIndex, nextCards);
}

function applyCardPatch(card: DatabasePageSummary, updates: Partial<PageInput>): DatabasePageSummary {
  const patch = normalizePatch(updates);
  const patchEntries = Object.entries(patch);
  if (patchEntries.length === 0) return card;
  if (patchEntries.every(([key, value]) =>
    patchValuesEqual(card[key as keyof DatabasePageSummary], value)
  )) return card;

  return {
    ...card,
    ...patch,
  };
}

function projectMovedCard(
  card: DatabasePageSummary,
  toStatus: MovePagesInput["toStatus"],
  fieldPatch: MovePagesInput["fieldPatch"],
): DatabasePageSummary {
  const patchedCard = fieldPatch ? applyCardPatch(card, fieldPatch) : card;
  if (patchedCard.status === toStatus) return patchedCard;
  return {
    ...patchedCard,
    status: toStatus,
  };
}

const cardRunsMatch = (
  left: readonly DatabasePageSummary[],
  right: readonly DatabasePageSummary[],
): boolean =>
  left.length === right.length
  && left.every((card, index) => card === right[index]);

function buildMovePageRunTransform(input: MovePagesInput): BoardTransform {
  const targetPageIds = new Set(input.pageIds);
  return (board) => {
    if (
      input.pageIds.length === 0
      || targetPageIds.size !== input.pageIds.length
    ) return board;

    const targetColumnIndex = board.columns.findIndex(
      (column) => column.id === input.toStatus,
    );
    if (targetColumnIndex < 0) return board;

    const movingCardsById = new Map<string, DatabasePageSummary>();
    const remainingCardsByColumn = board.columns.map((column) => {
      const remainingCards: DatabasePageSummary[] = [];
      for (const card of column.cards) {
        if (!targetPageIds.has(card.id)) {
          remainingCards.push(card);
          continue;
        }
        if (movingCardsById.has(card.id)) return null;
        movingCardsById.set(card.id, card);
      }
      return remainingCards;
    });
    if (
      remainingCardsByColumn.some((cards) => cards === null)
      || movingCardsById.size !== targetPageIds.size
    ) return board;

    const movingCards = input.pageIds.flatMap((pageId) => {
      const card = movingCardsById.get(pageId);
      return card
        ? [projectMovedCard(card, input.toStatus, input.fieldPatch)]
        : [];
    });
    if (movingCards.length !== input.pageIds.length) return board;

    const targetCards = remainingCardsByColumn[targetColumnIndex];
    if (!targetCards) return board;
    const nextTargetCards = [...targetCards];
    const insertIndex = clamp(
      input.newOrder ?? nextTargetCards.length,
      0,
      nextTargetCards.length,
    );
    nextTargetCards.splice(insertIndex, 0, ...movingCards);

    const desiredCardsByColumn = remainingCardsByColumn.map(
      (cards, columnIndex) =>
        columnIndex === targetColumnIndex ? nextTargetCards : cards,
    );
    if (board.columns.every((column, columnIndex) => {
      const desiredCards = desiredCardsByColumn[columnIndex];
      return desiredCards !== null
        && cardRunsMatch(column.cards, desiredCards);
    })) return board;

    let nextBoard = board;
    for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex += 1) {
      const desiredCards = desiredCardsByColumn[columnIndex];
      const currentCards = board.columns[columnIndex]?.cards;
      if (
        !desiredCards
        || !currentCards
        || cardRunsMatch(currentCards, desiredCards)
      ) continue;
      nextBoard = replaceColumnCards(nextBoard, columnIndex, desiredCards);
    }
    return nextBoard;
  };
}

export function buildPatchPageTransform(
  columnId: string | undefined,
  pageId: string,
  updates: Partial<PageInput>,
  options: PatchTransformOptions = {},
): BoardTransform {
  const patch = normalizePatch(updates);
  const patchEntries = Object.entries(patch);
  if (patchEntries.length === 0) {
    return (board) => board;
  }

  const shouldBumpRevision = options.bumpRevision === true;

  return (board) => {
    const location = findCardLocation(board, pageId, columnId);
    if (!location) return board;

    const column = board.columns[location.columnIndex];
    const target = column?.cards[location.pageIndex];
    if (!column || !target) return board;

    const changed = patchEntries.some(
      ([key, value]) =>
        !patchValuesEqual(target[key as keyof DatabasePageSummary], value),
    );
    if (!changed) return board;

    const nextCards = [...column.cards];
    const nextRevision = shouldBumpRevision
      ? ((target.revision ?? 0) + 1)
      : target.revision;
    nextCards[location.pageIndex] = {
      ...target,
      ...patch,
      ...(shouldBumpRevision ? { revision: nextRevision } : {}),
    };

    return replaceColumnCards(board, location.columnIndex, nextCards);
  };
}

export function createOptimisticCard(input: PageCreateInput): DatabasePageSummary {
  return {
    id: input.id ?? `optimistic:${crypto.randomUUID()}`,
    status: input.status ?? DEFAULT_WORKFLOW_STATUS,
    archived: false,
    title: input.title,
    richTitle: plainTextToPortableRichText(input.title),
    ...summarizePageDescription(input.description ?? ""),
    priority: input.priority ?? undefined,
    estimate: input.estimate ?? undefined,
    tags: input.tags ?? [],
    dueDate: input.dueDate ?? undefined,
    scheduledStart: input.scheduledStart ?? undefined,
    scheduledEnd: input.scheduledEnd ?? undefined,
    isAllDay: input.isAllDay ?? undefined,
    recurrence: input.recurrence ?? undefined,
    reminders: input.reminders ?? [],
    scheduleTimezone: input.scheduleTimezone ?? undefined,
    assignee: input.assignee ?? undefined,
    runInTarget: input.runInTarget ?? "localProject",
    runInLocalPath: input.runInLocalPath ?? undefined,
    runInBaseBranch: input.runInBaseBranch ?? undefined,
    runInWorktreePath: input.runInWorktreePath ?? undefined,
    runInEnvironmentPath: input.runInEnvironmentPath ?? undefined,
    created: new Date(),
    order: 0,
  };
}

export function buildCreateCardTransform(
  columnId: string,
  card: DatabasePageSummary,
  placement: PageCreatePlacement,
): BoardTransform {
  return (board) => insertNewCardIntoColumn(board, columnId, card, placement);
}

export function buildDeletePageTransform(
  columnId: string | undefined,
  pageId: string,
): BoardTransform {
  return (board) => {
    const location = findCardLocation(board, pageId, columnId);
    if (!location) return board;

    const column = board.columns[location.columnIndex];
    if (!column) return board;

    const nextCards = [...column.cards];
    nextCards.splice(location.pageIndex, 1);
    return replaceColumnCards(board, location.columnIndex, nextCards);
  };
}

export function buildMovePageTransform(input: MovePageInput): BoardTransform {
  return buildMovePageRunTransform({
    pageIds: [input.pageId],
    ...(input.fromStatus ? { fromStatus: input.fromStatus } : {}),
    toStatus: input.toStatus,
    ...(input.newOrder === undefined ? {} : { newOrder: input.newOrder }),
    ...(input.fieldPatch ? { fieldPatch: input.fieldPatch } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
  });
}

export function buildMovePagesTransform(input: MovePagesInput): BoardTransform {
  return buildMovePageRunTransform(input);
}

export function buildCompleteOrSkipOccurrenceTransform(pageId: string): BoardTransform {
  return (board) => {
    const location = findCardLocation(board, pageId);
    if (!location) return board;

    const column = board.columns[location.columnIndex];
    const card = column?.cards[location.pageIndex];
    if (
      !column
      || !card
      || card.recurrence
      || (card.scheduledStart === undefined && card.scheduledEnd === undefined)
    ) return board;

    const nextCards = [...column.cards];
    nextCards[location.pageIndex] = {
      ...card,
      scheduledStart: undefined,
      scheduledEnd: undefined,
    };
    return replaceColumnCards(board, location.columnIndex, nextCards);
  };
}

export function overlap(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  return left.some((key) => rightSet.has(key));
}

export function conflictKeyForCard(pageId: string): string {
  return `card:${pageId}:existence`;
}

export function conflictKeyForCardPosition(pageId: string): string {
  return `card:${pageId}:position`;
}

export function conflictKeyForCardField(pageId: string, field: string): string {
  return `card:${pageId}:field:${field}`;
}

export function conflictKeysForPatch(pageId: string, updates: Partial<PageInput>): string[] {
  const fields = Object.keys(updates);
  if (fields.length === 0) return [conflictKeyForCard(pageId)];
  return fields.map((field) => conflictKeyForCardField(pageId, field));
}

export function conflictKeysForCreate(columnId: string, pageId: string): string[] {
  void columnId;
  return [
    conflictKeyForCard(pageId),
  ];
}

export function conflictKeysForDelete(pageId: string): string[] {
  return [
    conflictKeyForCard(pageId),
    conflictKeyForCardPosition(pageId),
  ];
}

export function conflictKeysForMove(input: MovePageInput): string[] {
  const patchKeys = input.fieldPatch
    ? conflictKeysForPatch(input.pageId, input.fieldPatch)
    : [];
  return [
    conflictKeyForCardPosition(input.pageId),
    `column:${input.toStatus}:cards`,
    ...(input.fromStatus ? [`column:${input.fromStatus}:cards`] : []),
    ...patchKeys,
  ];
}

export function conflictKeysForMoveMany(input: MovePagesInput): string[] {
  const keys = [
    `column:${input.toStatus}:cards`,
    ...(input.fromStatus ? [`column:${input.fromStatus}:cards`] : []),
  ];
  for (const pageId of input.pageIds) {
    keys.push(conflictKeyForCardPosition(pageId));
    if (input.fieldPatch) {
      keys.push(...conflictKeysForPatch(pageId, input.fieldPatch));
    }
  }
  return keys;
}
