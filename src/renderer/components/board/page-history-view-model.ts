import type { PageHistoryEntry } from "../../../shared/page-history";

export const mergePageHistoryEntries = (
  current: readonly PageHistoryEntry[],
  incoming: readonly PageHistoryEntry[],
): readonly PageHistoryEntry[] => {
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
