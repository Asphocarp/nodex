import type {
  BoardSummary,
  CardSummary,
  CardCreateInput,
  CardCreatePlacement,
  CardInput,
  MoveCardInput,
  MoveCardsInput,
} from "./types";
import { DEFAULT_CARD_STATUS } from "../../shared/card-status";
import { cardInputToSummaryPatch, summarizeCardDescription } from "../../shared/card-summary";
import { plainTextToPortableRichText } from "../../shared/block-documents/portable-rich-text";

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

function normalizePatch(updates: Partial<CardInput>): Partial<CardSummary> {
  return cardInputToSummaryPatch(updates);
}

function findCardLocation(
  board: BoardSummary,
  cardId: string,
  preferredColumnId?: string,
): { columnIndex: number; cardIndex: number } | null {
  if (preferredColumnId) {
    const preferredColumnIndex = board.columns.findIndex((column) => column.id === preferredColumnId);
    if (preferredColumnIndex >= 0) {
      const preferredCardIndex = board.columns[preferredColumnIndex]?.cards.findIndex((card) => card.id === cardId) ?? -1;
      if (preferredCardIndex >= 0) {
        return { columnIndex: preferredColumnIndex, cardIndex: preferredCardIndex };
      }
    }
  }

  for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex += 1) {
    const cardIndex = board.columns[columnIndex]?.cards.findIndex((card) => card.id === cardId) ?? -1;
    if (cardIndex >= 0) return { columnIndex, cardIndex };
  }

  return null;
}

function reindexCards(cards: CardSummary[]): CardSummary[] {
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
  nextCards: CardSummary[],
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

function insertCardIntoColumn(
  board: BoardSummary,
  columnId: string,
  card: CardSummary,
  placement: CardCreatePlacement,
  insertIndex?: number,
): BoardSummary {
  const columnIndex = board.columns.findIndex((column) => column.id === columnId);
  if (columnIndex < 0) return board;

  const column = board.columns[columnIndex];
  if (!column) return board;

  const nextCards = [...column.cards];
  const beforeCardIndex = typeof placement === "object"
    ? nextCards.findIndex((candidate) => candidate.id === placement.beforeCardId)
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

function applyCardPatch(card: CardSummary, updates: Partial<CardInput>): CardSummary {
  const patch = normalizePatch(updates);
  if (Object.keys(patch).length === 0) {
    return card;
  }

  return {
    ...card,
    ...patch,
  };
}

export function buildPatchCardTransform(
  columnId: string | undefined,
  cardId: string,
  updates: Partial<CardInput>,
  options: PatchTransformOptions = {},
): BoardTransform {
  const patch = normalizePatch(updates);
  const patchEntries = Object.entries(patch);
  if (patchEntries.length === 0) {
    return (board) => board;
  }

  const shouldBumpRevision = options.bumpRevision === true;

  return (board) => {
    const location = findCardLocation(board, cardId, columnId);
    if (!location) return board;

    const column = board.columns[location.columnIndex];
    const target = column?.cards[location.cardIndex];
    if (!column || !target) return board;

    const changed = patchEntries.some(
      ([key, value]) =>
        !patchValuesEqual(target[key as keyof CardSummary], value),
    );
    if (!changed) return board;

    const nextCards = [...column.cards];
    const nextRevision = shouldBumpRevision
      ? ((target.revision ?? 0) + 1)
      : target.revision;
    nextCards[location.cardIndex] = {
      ...target,
      ...patch,
      ...(shouldBumpRevision ? { revision: nextRevision } : {}),
    };

    return replaceColumnCards(board, location.columnIndex, nextCards);
  };
}

export function createOptimisticCard(input: CardCreateInput): CardSummary {
  return {
    id: input.id ?? `optimistic:${crypto.randomUUID()}`,
    status: input.status ?? DEFAULT_CARD_STATUS,
    archived: false,
    title: input.title,
    richTitle: plainTextToPortableRichText(input.title),
    ...summarizeCardDescription(input.description ?? ""),
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
    agentBlocked: input.agentBlocked ?? false,
    agentStatus: input.agentStatus ?? undefined,
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
  card: CardSummary,
  placement: CardCreatePlacement,
): BoardTransform {
  return (board) => insertCardIntoColumn(board, columnId, card, placement);
}

export function buildDeleteCardTransform(
  columnId: string | undefined,
  cardId: string,
): BoardTransform {
  return (board) => {
    const location = findCardLocation(board, cardId, columnId);
    if (!location) return board;

    const column = board.columns[location.columnIndex];
    if (!column) return board;

    const nextCards = [...column.cards];
    nextCards.splice(location.cardIndex, 1);
    return replaceColumnCards(board, location.columnIndex, nextCards);
  };
}

export function buildMoveCardTransform(input: MoveCardInput): BoardTransform {
  return (board) => {
    const location = findCardLocation(board, input.cardId, input.fromStatus);
    if (!location) return board;

    const sourceColumn = board.columns[location.columnIndex];
    if (!sourceColumn) return board;
    const movingCard = sourceColumn.cards[location.cardIndex];
    if (!movingCard) return board;
    const patchedCard = input.fieldPatch
      ? applyCardPatch(movingCard, input.fieldPatch)
      : movingCard;

    const withoutSourceCards = [...sourceColumn.cards];
    withoutSourceCards.splice(location.cardIndex, 1);
    let nextBoard = replaceColumnCards(board, location.columnIndex, withoutSourceCards);

    const targetColumnIndex = nextBoard.columns.findIndex((column) => column.id === input.toStatus);
    if (targetColumnIndex < 0) return board;
    const targetColumn = nextBoard.columns[targetColumnIndex];
    if (!targetColumn) return board;

    const targetCards = [...targetColumn.cards];
    const insertIndex = clamp(input.newOrder ?? targetCards.length, 0, targetCards.length);
    targetCards.splice(insertIndex, 0, patchedCard);
    nextBoard = replaceColumnCards(nextBoard, targetColumnIndex, targetCards);
    return nextBoard;
  };
}

export function buildMoveCardsTransform(input: MoveCardsInput): BoardTransform {
  const targetCardIds = new Set(input.cardIds);
  return (board) => {
    if (targetCardIds.size === 0) return board;

    const movingCards: CardSummary[] = [];
    let nextBoard = board;

    for (let columnIndex = 0; columnIndex < nextBoard.columns.length; columnIndex += 1) {
      const column = nextBoard.columns[columnIndex];
      if (!column) continue;

      const retainedCards: CardSummary[] = [];
      let changed = false;
      for (const card of column.cards) {
        if (!targetCardIds.has(card.id)) {
          retainedCards.push(card);
          continue;
        }
        changed = true;
        movingCards.push(input.fieldPatch ? applyCardPatch(card, input.fieldPatch) : card);
      }

      if (!changed) continue;
      nextBoard = replaceColumnCards(nextBoard, columnIndex, retainedCards);
    }

    if (movingCards.length === 0) return board;

    const targetColumnIndex = nextBoard.columns.findIndex((column) => column.id === input.toStatus);
    if (targetColumnIndex < 0) return board;
    const targetColumn = nextBoard.columns[targetColumnIndex];
    if (!targetColumn) return board;

    const targetCards = [...targetColumn.cards];
    const insertIndex = clamp(input.newOrder ?? targetCards.length, 0, targetCards.length);
    targetCards.splice(insertIndex, 0, ...movingCards);
    nextBoard = replaceColumnCards(nextBoard, targetColumnIndex, targetCards);
    return nextBoard;
  };
}

export function buildCompleteOrSkipOccurrenceTransform(cardId: string): BoardTransform {
  return (board) => {
    const location = findCardLocation(board, cardId);
    if (!location) return board;

    const column = board.columns[location.columnIndex];
    const card = column?.cards[location.cardIndex];
    if (!column || !card || card.recurrence) return board;

    const nextCards = [...column.cards];
    nextCards[location.cardIndex] = {
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

export function conflictKeyForCard(cardId: string): string {
  return `card:${cardId}:existence`;
}

export function conflictKeyForCardPosition(cardId: string): string {
  return `card:${cardId}:position`;
}

export function conflictKeyForCardField(cardId: string, field: string): string {
  return `card:${cardId}:field:${field}`;
}

export function conflictKeysForPatch(cardId: string, updates: Partial<CardInput>): string[] {
  const fields = Object.keys(updates);
  if (fields.length === 0) return [conflictKeyForCard(cardId)];
  return fields.map((field) => conflictKeyForCardField(cardId, field));
}

export function conflictKeysForCreate(columnId: string, cardId: string): string[] {
  void columnId;
  return [
    conflictKeyForCard(cardId),
  ];
}

export function conflictKeysForDelete(cardId: string): string[] {
  return [
    conflictKeyForCard(cardId),
    conflictKeyForCardPosition(cardId),
  ];
}

export function conflictKeysForMove(input: MoveCardInput): string[] {
  const patchKeys = input.fieldPatch
    ? conflictKeysForPatch(input.cardId, input.fieldPatch)
    : [];
  return [
    conflictKeyForCardPosition(input.cardId),
    `column:${input.toStatus}:cards`,
    ...(input.fromStatus ? [`column:${input.fromStatus}:cards`] : []),
    ...patchKeys,
  ];
}

export function conflictKeysForMoveMany(input: MoveCardsInput): string[] {
  const keys = [
    `column:${input.toStatus}:cards`,
    ...(input.fromStatus ? [`column:${input.fromStatus}:cards`] : []),
  ];
  for (const cardId of input.cardIds) {
    keys.push(conflictKeyForCardPosition(cardId));
    if (input.fieldPatch) {
      keys.push(...conflictKeysForPatch(cardId, input.fieldPatch));
    }
  }
  return keys;
}
