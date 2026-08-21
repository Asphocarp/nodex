export interface BoardKeyboardModel {
  readonly columns: readonly {
    readonly id: string;
    readonly cards: readonly { readonly id: string }[];
  }[];
}

export type BoardKeyboardDirection = "next" | "previous" | "left" | "right";

export interface BoardKeyboardLocation {
  readonly pageId: string;
  readonly columnId: string;
  readonly columnIndex: number;
  readonly cardIndex: number;
}

export function findBoardKeyboardLocation(
  board: BoardKeyboardModel,
  pageId: string | null,
): BoardKeyboardLocation | null {
  for (const [columnIndex, column] of board.columns.entries()) {
    const cardIndex = pageId ? column.cards.findIndex((card) => card.id === pageId) : -1;
    if (cardIndex < 0) continue;
    return {
      pageId: column.cards[cardIndex]!.id,
      columnId: column.id,
      columnIndex,
      cardIndex,
    };
  }
  return null;
}

export function firstBoardKeyboardLocation(
  board: BoardKeyboardModel,
): BoardKeyboardLocation | null {
  for (const [columnIndex, column] of board.columns.entries()) {
    const card = column.cards[0];
    if (!card) continue;
    return {
      pageId: card.id,
      columnId: column.id,
      columnIndex,
      cardIndex: 0,
    };
  }
  return null;
}

export function resolveBoardKeyboardNavigation(
  board: BoardKeyboardModel,
  currentPageId: string | null,
  direction: BoardKeyboardDirection,
): BoardKeyboardLocation | null {
  const current = findBoardKeyboardLocation(board, currentPageId);
  if (!current) return firstBoardKeyboardLocation(board);

  if (direction === "next" || direction === "previous") {
    const locations = board.columns.flatMap((column, columnIndex) =>
      column.cards.map((card, cardIndex) => ({
        pageId: card.id,
        columnId: column.id,
        columnIndex,
        cardIndex,
      })),
    );
    const index = locations.findIndex((location) => location.pageId === current.pageId);
    const offset = direction === "next" ? 1 : -1;
    return locations[Math.max(0, Math.min(locations.length - 1, index + offset))] ?? current;
  }

  const columnOffset = direction === "right" ? 1 : -1;
  for (
    let columnIndex = current.columnIndex + columnOffset;
    columnIndex >= 0 && columnIndex < board.columns.length;
    columnIndex += columnOffset
  ) {
    const column = board.columns[columnIndex];
    if (!column || column.cards.length === 0) continue;
    const cardIndex = Math.min(current.cardIndex, column.cards.length - 1);
    return {
      pageId: column.cards[cardIndex]!.id,
      columnId: column.id,
      columnIndex,
      cardIndex,
    };
  }

  return current;
}

export function resolveBoardKeyboardActionPageIds(
  board: BoardKeyboardModel,
  highlightedPageId: string | null,
  selectedPageIds: ReadonlySet<string>,
): readonly string[] {
  if (!highlightedPageId) return [];
  if (!selectedPageIds.has(highlightedPageId)) return [highlightedPageId];
  return board.columns.flatMap((column) =>
    column.cards.flatMap((card) => (selectedPageIds.has(card.id) ? [card.id] : [])),
  );
}
