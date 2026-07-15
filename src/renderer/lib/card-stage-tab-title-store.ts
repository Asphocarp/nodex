export interface CardStageTabTitleSource {
  readonly getSnapshot: () => string;
  readonly subscribe: (listener: () => void) => () => void;
}

interface CardStageTabTitleEntry {
  committedTitle?: string;
  liveTitle?: string;
  readonly listeners: Set<() => void>;
}

export interface CardStageTabTitleStore {
  createSource: (key: string, fallbackTitle: string) => CardStageTabTitleSource;
  publishCommitted: (key: string, title: string) => void;
  publishLive: (key: string, title: string) => void;
  clearLive: (key: string) => void;
  release: (key: string) => void;
}

export const makeCardStageTabTitleKey = (
  sessionId: string,
  tabId: string,
): string => JSON.stringify([sessionId, tabId]);

const presentCardStageTabTitle = (title: string): string =>
  title.trim() || "Untitled";

const readEntryTitle = (
  entry: CardStageTabTitleEntry | undefined,
): string | undefined => entry?.liveTitle ?? entry?.committedTitle;

export function createCardStageTabTitleStore(): CardStageTabTitleStore {
  const entries = new Map<string, CardStageTabTitleEntry>();

  const getOrCreateEntry = (key: string): CardStageTabTitleEntry => {
    const existing = entries.get(key);
    if (existing) return existing;

    const entry: CardStageTabTitleEntry = { listeners: new Set() };
    entries.set(key, entry);
    return entry;
  };

  const publish = (
    key: string,
    source: "committedTitle" | "liveTitle",
    title: string,
  ): void => {
    const entry = getOrCreateEntry(key);
    const previousTitle = readEntryTitle(entry);
    if (entry[source] === title) return;

    entry[source] = title;
    if (readEntryTitle(entry) === previousTitle) return;
    entry.listeners.forEach((listener) => listener());
  };

  return {
    createSource: (key, fallbackTitle) => ({
      getSnapshot: () => presentCardStageTabTitle(
        readEntryTitle(entries.get(key)) ?? fallbackTitle,
      ),
      subscribe: (listener) => {
        const entry = getOrCreateEntry(key);
        entry.listeners.add(listener);
        return () => {
          entry.listeners.delete(listener);
          if (
            entry.listeners.size === 0
            && entry.committedTitle === undefined
            && entry.liveTitle === undefined
            && entries.get(key) === entry
          ) {
            entries.delete(key);
          }
        };
      },
    }),
    publishCommitted: (key, title) => publish(key, "committedTitle", title),
    publishLive: (key, title) => publish(key, "liveTitle", title),
    clearLive: (key) => {
      const entry = entries.get(key);
      if (!entry || entry.liveTitle === undefined) return;

      const previousTitle = readEntryTitle(entry);
      delete entry.liveTitle;
      if (readEntryTitle(entry) !== previousTitle) {
        entry.listeners.forEach((listener) => listener());
      }
      if (entry.listeners.size === 0 && entry.committedTitle === undefined) {
        entries.delete(key);
      }
    },
    release: (key) => {
      const entry = entries.get(key);
      if (!entry) return;

      entries.delete(key);
      entry.listeners.forEach((listener) => listener());
    },
  };
}
