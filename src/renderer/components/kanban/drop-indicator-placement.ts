interface IdentifiableCard {
  id: string;
}

export interface DropIndicatorPlacement {
  beforePageId: string | null;
  atEnd: boolean;
}

export function resolveDropIndicatorPlacement(
  cards: readonly IdentifiableCard[],
  draggedPageIds: ReadonlySet<string>,
  dropIndicatorIndex: number | undefined,
): DropIndicatorPlacement {
  if (typeof dropIndicatorIndex !== "number" || dropIndicatorIndex < 0) {
    return {
      beforePageId: null,
      atEnd: false,
    };
  }

  let remainingIndex = 0;
  for (const card of cards) {
    if (draggedPageIds.has(card.id)) {
      continue;
    }

    if (remainingIndex === dropIndicatorIndex) {
      return {
        beforePageId: card.id,
        atEnd: false,
      };
    }

    remainingIndex += 1;
  }

  return {
    beforePageId: null,
    atEnd: dropIndicatorIndex === remainingIndex,
  };
}
