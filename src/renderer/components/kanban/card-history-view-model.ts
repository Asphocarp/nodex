import type { CardHistoryEntry } from "../../../shared/card-history";

export const mergeCardHistoryEntries = (
  current: readonly CardHistoryEntry[],
  incoming: readonly CardHistoryEntry[],
): readonly CardHistoryEntry[] => {
  const seen = new Set(current.map((entry) => entry.id));
  return [
    ...current,
    ...incoming.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    }),
  ];
};
