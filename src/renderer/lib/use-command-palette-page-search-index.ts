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
  pages: CommandPalettePage[];
  index: CommandPalettePageSearchIndex | null;
}

export function useCommandPalettePageSearchIndex(
  pages: CommandPalettePage[],
): CommandPalettePageSearchIndex | null {
  const fastIndex = useMemo(
    () => createCommandPalettePageFastSearchIndex(pages),
    [pages],
  );
  const latestPagesRef = useRef(pages);
  latestPagesRef.current = pages;
  const [state, setState] = useState<CommandPalettePageSearchIndexState>(() => ({
    pages,
    index: getCachedCommandPalettePageSearchIndex(pages) ?? fastIndex,
  }));

  useEffect(() => {
    const nextPages = latestPagesRef.current;
    const fallbackIndex = createCommandPalettePageFastSearchIndex(nextPages);
    const cachedIndex = getCachedCommandPalettePageSearchIndex(nextPages);
    if (cachedIndex) {
      setState((current) => (
        current.pages === nextPages && current.index !== null
          ? current
          : { pages: nextPages, index: cachedIndex }
      ));
      return;
    }

    if (nextPages.length === 0) {
      setState((current) => (
        current.pages === nextPages && current.index !== null
          ? current
          : {
            pages: nextPages,
            index: fallbackIndex,
          }
      ));
      return;
    }

    if (typeof indexedDB === "undefined") {
      setState((current) => (
        current.pages === nextPages && current.index !== null
          ? current
          : {
            pages: nextPages,
            index: createCommandPalettePageSearchIndex(nextPages),
          }
      ));
      return;
    }

    let cancelled = false;
    setState((current) => (
      current.pages === nextPages && current.index !== null
        ? current
        : { pages: nextPages, index: fallbackIndex }
    ));

    void hydrateCommandPalettePageSearchIndex(nextPages)
      .then((index) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setState({ pages: nextPages, index });
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setState({
            pages: latestPagesRef.current,
            index: createCommandPalettePageSearchIndex(latestPagesRef.current),
          });
        });
      });

    return () => {
      cancelled = true;
    };
  }, [pages]);

  if (state.pages !== pages) {
    return fastIndex;
  }

  return state.index;
}
