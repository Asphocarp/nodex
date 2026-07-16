export interface PageStageTabTitleSource {
  readonly getSnapshot: () => string;
  readonly subscribe: (listener: () => void) => () => void;
}

interface PageStageTabTitleEntry {
  committedTitle?: string;
  liveTitle?: string;
  readonly listeners: Set<() => void>;
}

export interface PageStageTabTitleStore {
  createSource: (key: string, fallbackTitle: string) => PageStageTabTitleSource;
  publishCommitted: (key: string, title: string) => void;
  publishLive: (key: string, title: string) => void;
  clearLive: (key: string) => void;
  release: (key: string) => void;
}

export const makePageStageTabTitleKey = (
  sessionId: string,
  tabId: string,
): string => JSON.stringify([sessionId, tabId]);

const presentPageStageTabTitle = (title: string): string =>
  title.trim() || "Untitled";

const readEntryTitle = (
  entry: PageStageTabTitleEntry | undefined,
): string | undefined => entry?.liveTitle ?? entry?.committedTitle;

export function createPageStageTabTitleStore(): PageStageTabTitleStore {
  const entries = new Map<string, PageStageTabTitleEntry>();

  const getOrCreateEntry = (key: string): PageStageTabTitleEntry => {
    const existing = entries.get(key);
    if (existing) return existing;

    const entry: PageStageTabTitleEntry = { listeners: new Set() };
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
      getSnapshot: () => presentPageStageTabTitle(
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
