import { useMemo } from "react";
import type { CommandPaletteThread } from "./command-palette";
import {
  createCommandPaletteThreadSearchIndex,
  type CommandPaletteThreadSearchIndex,
} from "./command-palette-thread-search";

function buildThreadsKey(threads: CommandPaletteThread[]): string {
  return threads
    .map((item) => [
      item.id,
      item.title,
      item.preview,
      item.projectName,
      item.cwd ?? "",
      item.statusType,
      item.statusActiveFlags.join(","),
      item.updatedAt,
    ].join("\u0001"))
    .join("\u0002");
}

export function useCommandPaletteThreadSearchIndex(
  threads: CommandPaletteThread[],
): CommandPaletteThreadSearchIndex {
  const threadsKey = useMemo(() => buildThreadsKey(threads), [threads]);

  return useMemo(
    () => {
      void threadsKey;
      return createCommandPaletteThreadSearchIndex(threads);
    },
    [threads, threadsKey],
  );
}
