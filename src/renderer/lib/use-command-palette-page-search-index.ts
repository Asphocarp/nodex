import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { CommandPalettePage } from "./command-palette";
import {
  createCommandPalettePageFastSearchIndex,
  createCommandPalettePageSearchIndex,
  getCachedCommandPalettePageSearchIndex,
  hydrateCommandPalettePageSearchIndex,
  type CommandPalettePageSearchIndex,
} from "./command-palette-page-search";

interface CommandPalettePageSearchIndexState {
  cardsKey: string;
  index: CommandPalettePageSearchIndex | null;
}

function buildPagesKey(pages: readonly CommandPalettePage[]): string {
  return pages
    .map((item) => [
      item.id,
      item.projectId,
      item.projectName,
      item.columnName,
      item.inActiveProject ? "1" : "0",
      item.recentIndex ?? "",
      item.boardIndex,
      item.page.revision,
      item.page.status,
      item.page.priority ?? "",
      item.page.estimate ?? "",
      item.page.archived ? "1" : "0",
      item.page.title,
      item.page.descriptionPreview,
      item.page.assignee ?? "",
      item.tagLabels.join(","),
    ].join("\u0001"))
    .join("\u0002");
}

export function useCommandPalettePageSearchIndex(
  pages: CommandPalettePage[],
): CommandPalettePageSearchIndex | null {
  const cardsKey = useMemo(() => buildPagesKey(pages), [pages]);
  const fastIndex = useMemo(() => {
    void cardsKey;
    return createCommandPalettePageFastSearchIndex(pages);
  }, [pages, cardsKey]);
  const latestPagesRef = useRef(pages);
  latestPagesRef.current = pages;
  const [state, setState] = useState<CommandPalettePageSearchIndexState>(() => ({
    cardsKey,
    index: getCachedCommandPalettePageSearchIndex(pages) ?? fastIndex,
  }));

  useEffect(() => {
    const nextPages = latestPagesRef.current;
    const fallbackIndex = createCommandPalettePageFastSearchIndex(nextPages);
    const cachedIndex = getCachedCommandPalettePageSearchIndex(nextPages);
    if (cachedIndex) {
      setState((current) => (
        current.cardsKey === cardsKey && current.index !== null
          ? current
          : { cardsKey, index: cachedIndex }
      ));
      return;
    }

    if (nextPages.length === 0) {
      setState((current) => (
        current.cardsKey === cardsKey && current.index !== null
          ? current
          : {
            cardsKey,
            index: fallbackIndex,
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
            index: createCommandPalettePageSearchIndex(nextPages),
          }
      ));
      return;
    }

    let cancelled = false;
    setState((current) => (
      current.cardsKey === cardsKey && current.index !== null
        ? current
        : { cardsKey, index: fallbackIndex }
    ));

    void hydrateCommandPalettePageSearchIndex(nextPages)
      .then((index) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setState({ cardsKey, index });
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setState({
            cardsKey,
            index: createCommandPalettePageSearchIndex(latestPagesRef.current),
          });
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cardsKey]);

  if (state.cardsKey !== cardsKey) {
    return fastIndex;
  }

  return state.index;
}
