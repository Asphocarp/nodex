export interface PageTitleSource {
  readonly getSnapshot: () => string;
  readonly subscribe: (listener: () => void) => () => void;
}

interface LivePageTitle {
  readonly title: string;
  readonly revision: number;
}

interface PageTitleEntry {
  readonly liveTitlesByPublisher: Map<string, LivePageTitle>;
  readonly listeners: Set<() => void>;
}

export interface PageTitleProjectionStore {
  createSource: (resourceKey: string, fallbackTitle: string) => PageTitleSource;
  publishLive: (
    resourceKey: string,
    publisherId: string,
    title: string,
  ) => void;
  releasePublisher: (resourceKey: string, publisherId: string) => void;
}

export const makePageTitleResourceKey = (
  libraryId: string,
  pageId: string,
): string => JSON.stringify([libraryId, pageId]);

const presentPageTitle = (title: string): string => title.trim() || "Untitled";

const latestLiveTitle = (entry: PageTitleEntry): string | undefined => {
  let latest: LivePageTitle | undefined;
  for (const candidate of entry.liveTitlesByPublisher.values()) {
    if (!latest || candidate.revision > latest.revision) latest = candidate;
  }
  return latest?.title;
};

const readEntryTitle = (
  entry: PageTitleEntry | undefined,
): string | undefined => entry ? latestLiveTitle(entry) : undefined;

/**
 * Renderer-lifetime projection of Page titles into non-authoritative chrome.
 *
 * The Page resource, rather than a particular tab occurrence, is the identity.
 * Y.Text publishers remain isolated by editor surface so one unmount cannot
 * clear another still-mounted editor's live title.
 */
export function createPageTitleProjectionStore(): PageTitleProjectionStore {
  const entries = new Map<string, PageTitleEntry>();
  let revision = 0;

  const getOrCreateEntry = (resourceKey: string): PageTitleEntry => {
    const existing = entries.get(resourceKey);
    if (existing) return existing;

    const entry: PageTitleEntry = {
      liveTitlesByPublisher: new Map(),
      listeners: new Set(),
    };
    entries.set(resourceKey, entry);
    return entry;
  };

  const notifyIfChanged = (
    entry: PageTitleEntry,
    previousTitle: string | undefined,
  ): void => {
    if (readEntryTitle(entry) === previousTitle) return;
    entry.listeners.forEach((listener) => listener());
  };

  const deleteIfUnused = (resourceKey: string, entry: PageTitleEntry): void => {
    if (entry.listeners.size > 0 || entry.liveTitlesByPublisher.size > 0) return;
    if (entries.get(resourceKey) !== entry) return;
    entries.delete(resourceKey);
  };

  const releasePublisher = (resourceKey: string, publisherId: string): void => {
    const entry = entries.get(resourceKey);
    if (!entry || !entry.liveTitlesByPublisher.has(publisherId)) return;

    const previousTitle = readEntryTitle(entry);
    entry.liveTitlesByPublisher.delete(publisherId);
    notifyIfChanged(entry, previousTitle);
    deleteIfUnused(resourceKey, entry);
  };

  return {
    createSource: (resourceKey, fallbackTitle) => ({
      getSnapshot: () => presentPageTitle(
        readEntryTitle(entries.get(resourceKey)) ?? fallbackTitle,
      ),
      subscribe: (listener) => {
        const entry = getOrCreateEntry(resourceKey);
        entry.listeners.add(listener);
        return () => {
          entry.listeners.delete(listener);
          deleteIfUnused(resourceKey, entry);
        };
      },
    }),
    publishLive: (resourceKey, publisherId, title) => {
      const entry = getOrCreateEntry(resourceKey);
      if (entry.liveTitlesByPublisher.get(publisherId)?.title === title) return;

      const previousTitle = readEntryTitle(entry);
      revision += 1;
      entry.liveTitlesByPublisher.set(publisherId, { title, revision });
      notifyIfChanged(entry, previousTitle);
    },
    releasePublisher,
  };
}
