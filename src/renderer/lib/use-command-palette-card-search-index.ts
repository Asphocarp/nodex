import { useEffect, useMemo, useRef, useState } from "react";
import type { CommandPaletteCard } from "./command-palette";
import {
  createCommandPaletteCardSearchIndex,
  getCachedCommandPaletteCardSearchIndex,
  hydrateCommandPaletteCardSearchIndex,
  type CommandPaletteCardSearchIndex,
} from "./command-palette-card-search";

interface CommandPaletteCardSearchIndexState {
  cardsKey: string;
  index: CommandPaletteCardSearchIndex | null;
}

function buildCardsKey(cards: readonly CommandPaletteCard[]): string {
  return cards
    .map((item) => [
      item.id,
      item.projectId,
      item.projectName,
      item.columnName,
      item.inActiveProject ? "1" : "0",
      item.recentIndex ?? "",
      item.boardIndex,
      item.card.revision,
      item.card.status,
      item.card.priority ?? "",
      item.card.estimate ?? "",
      item.card.archived ? "1" : "0",
      item.card.title,
      item.card.descriptionPreview,
      item.card.assignee ?? "",
      item.card.agentStatus ?? "",
      item.card.tags.join(","),
    ].join("\u0001"))
    .join("\u0002");
}

export function useCommandPaletteCardSearchIndex(
  cards: CommandPaletteCard[],
): CommandPaletteCardSearchIndex | null {
  const cardsKey = useMemo(() => buildCardsKey(cards), [cards]);
  const latestCardsRef = useRef(cards);
  latestCardsRef.current = cards;
  const [state, setState] = useState<CommandPaletteCardSearchIndexState>(() => ({
    cardsKey,
    index: getCachedCommandPaletteCardSearchIndex(cards),
  }));

  useEffect(() => {
    const nextCards = latestCardsRef.current;
    const cachedIndex = getCachedCommandPaletteCardSearchIndex(nextCards);
    if (cachedIndex) {
      setState((current) => (
        current.cardsKey === cardsKey && current.index !== null
          ? current
          : { cardsKey, index: cachedIndex }
      ));
      return;
    }

    if (nextCards.length === 0) {
      setState((current) => (
        current.cardsKey === cardsKey && current.index !== null
          ? current
          : {
            cardsKey,
            index: createCommandPaletteCardSearchIndex([]),
          }
      ));
      return;
    }

    if (typeof indexedDB === "undefined") {
      setState((current) => (
        current.cardsKey === cardsKey && current.index !== null
          ? current
          : {
            cardsKey,
            index: createCommandPaletteCardSearchIndex(nextCards),
          }
      ));
      return;
    }

    let cancelled = false;
    setState((current) => (
      current.cardsKey === cardsKey && current.index === null
        ? current
        : { cardsKey, index: null }
    ));

    void hydrateCommandPaletteCardSearchIndex(nextCards)
      .then((index) => {
        if (cancelled) {
          return;
        }

        setState((current) => (
          current.cardsKey === cardsKey && current.index !== null
            ? current
            : { cardsKey, index }
        ));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setState({
          cardsKey,
          index: createCommandPaletteCardSearchIndex(latestCardsRef.current),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cardsKey]);

  if (state.cardsKey !== cardsKey) {
    return null;
  }

  return state.index;
}
