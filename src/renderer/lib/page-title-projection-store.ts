export interface PageTitleSource {
  readonly getSnapshot: () => string;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface PageTitleAuthorityVersion {
  readonly generation: number;
  readonly headSeq: number;
}

interface LivePageTitle {
  readonly title: string;
  readonly revision: number;
  readonly baselineVersion: PageTitleAuthorityVersion;
}

interface CanonicalPageTitle {
  readonly title: string;
  readonly version: PageTitleAuthorityVersion;
}

interface PageTitleEntry {
  readonly liveTitlesByPublisher: Map<string, LivePageTitle>;
  readonly listeners: Set<() => void>;
  lastAccessRevision: number;
  retainedLiveTitle?: LivePageTitle;
  canonicalTitle?: CanonicalPageTitle;
}

export interface PageTitleProjectionStore {
  createSource: (resourceKey: string, fallbackTitle: string) => PageTitleSource;
  publishCanonical: (
    resourceKey: string,
    title: string,
    version: PageTitleAuthorityVersion,
  ) => void;
  publishLive: (
    resourceKey: string,
    publisherId: string,
    title: string,
    baselineVersion: PageTitleAuthorityVersion,
  ) => void;
  releasePublisher: (resourceKey: string, publisherId: string) => void;
}

export const makePageTitleResourceKey = (libraryId: string, pageId: string): string =>
  JSON.stringify([libraryId, pageId]);

const presentPageTitle = (title: string): string => title.trim() || "Untitled";
const MAX_RETAINED_PAGE_TITLES = 1_000;

const compareAuthorityVersions = (
  left: PageTitleAuthorityVersion,
  right: PageTitleAuthorityVersion,
): number => {
  if (left.generation !== right.generation) return left.generation - right.generation;
  return left.headSeq - right.headSeq;
};

const latestLiveTitle = (entry: PageTitleEntry): LivePageTitle | undefined => {
  let latest: LivePageTitle | undefined;
  for (const candidate of entry.liveTitlesByPublisher.values()) {
    if (!latest || candidate.revision > latest.revision) latest = candidate;
  }
  return latest;
};

const readEntryTitle = (entry: PageTitleEntry | undefined): string | undefined =>
  entry
    ? (latestLiveTitle(entry)?.title ??
      entry.retainedLiveTitle?.title ??
      entry.canonicalTitle?.title)
    : undefined;

const canonicalMaterializesLiveTitle = (
  canonicalTitle: CanonicalPageTitle | undefined,
  liveTitle: LivePageTitle,
): boolean => {
  if (!canonicalTitle) return false;
  if (presentPageTitle(canonicalTitle.title) === presentPageTitle(liveTitle.title)) return true;
  return compareAuthorityVersions(canonicalTitle.version, liveTitle.baselineVersion) > 0;
};

/**
 * Renderer-lifetime projection of Page titles into non-authoritative chrome.
 *
 * The Page resource, rather than a particular tab occurrence, is the identity.
 * Y.Text publishers remain isolated by editor surface so one unmount cannot
 * clear another still-mounted editor's live title. After the final publisher
 * unmounts, its last observed title remains as an overlay until a matching or
 * newer canonical Document head materializes it.
 */
export function createPageTitleProjectionStore(
  options: { readonly maxRetainedTitles?: number } = {},
): PageTitleProjectionStore {
  const entries = new Map<string, PageTitleEntry>();
  const maxRetainedTitles = Math.max(
    1,
    Math.floor(options.maxRetainedTitles ?? MAX_RETAINED_PAGE_TITLES),
  );
  let revision = 0;
  let accessRevision = 0;

  const touch = (entry: PageTitleEntry): void => {
    accessRevision += 1;
    entry.lastAccessRevision = accessRevision;
  };

  const getOrCreateEntry = (resourceKey: string): PageTitleEntry => {
    const existing = entries.get(resourceKey);
    if (existing) return existing;

    const entry: PageTitleEntry = {
      liveTitlesByPublisher: new Map(),
      listeners: new Set(),
      lastAccessRevision: 0,
    };
    touch(entry);
    entries.set(resourceKey, entry);
    return entry;
  };

  const notifyIfChanged = (entry: PageTitleEntry, previousTitle: string | undefined): void => {
    if (readEntryTitle(entry) === previousTitle) return;
    entry.listeners.forEach((listener) => listener());
  };

  const pruneRetainedEntries = (): void => {
    if (entries.size <= maxRetainedTitles) return;
    const candidates = [...entries.entries()]
      .filter(
        ([, entry]) =>
          entry.listeners.size === 0 &&
          entry.liveTitlesByPublisher.size === 0 &&
          entry.retainedLiveTitle !== undefined,
      )
      .sort(([, left], [, right]) => left.lastAccessRevision - right.lastAccessRevision);
    for (const [resourceKey, entry] of candidates) {
      if (entries.size <= maxRetainedTitles) return;
      if (entries.get(resourceKey) === entry) entries.delete(resourceKey);
    }
  };

  const deleteIfUnused = (resourceKey: string, entry: PageTitleEntry): void => {
    if (entry.listeners.size > 0 || entry.liveTitlesByPublisher.size > 0) return;
    if (entry.retainedLiveTitle) {
      pruneRetainedEntries();
      return;
    }
    if (entries.get(resourceKey) !== entry) return;
    entries.delete(resourceKey);
  };

  const releasePublisher = (resourceKey: string, publisherId: string): void => {
    const entry = entries.get(resourceKey);
    const releasedTitle = entry?.liveTitlesByPublisher.get(publisherId);
    if (!entry || !releasedTitle) return;

    const previousTitle = readEntryTitle(entry);
    touch(entry);
    entry.liveTitlesByPublisher.delete(publisherId);
    if (entry.liveTitlesByPublisher.size === 0) {
      entry.retainedLiveTitle = !canonicalMaterializesLiveTitle(entry.canonicalTitle, releasedTitle)
        ? releasedTitle
        : undefined;
    }
    notifyIfChanged(entry, previousTitle);
    deleteIfUnused(resourceKey, entry);
  };

  return {
    createSource: (resourceKey, fallbackTitle) => ({
      getSnapshot: () =>
        presentPageTitle(readEntryTitle(entries.get(resourceKey)) ?? fallbackTitle),
      subscribe: (listener) => {
        const entry = getOrCreateEntry(resourceKey);
        touch(entry);
        entry.listeners.add(listener);
        return () => {
          entry.listeners.delete(listener);
          deleteIfUnused(resourceKey, entry);
        };
      },
    }),
    publishCanonical: (resourceKey, title, version) => {
      const entry = getOrCreateEntry(resourceKey);
      touch(entry);
      const current = entry.canonicalTitle;
      let versionAdvancedWithoutTitleChange = false;
      if (current) {
        const comparison = compareAuthorityVersions(version, current.version);
        if (comparison < 0) return;
        if (comparison === 0 && current.title === title) return;
        versionAdvancedWithoutTitleChange =
          comparison > 0 && presentPageTitle(current.title) === presentPageTitle(title);
      }

      const previousTitle = readEntryTitle(entry);
      entry.canonicalTitle = { title, version };
      if (versionAdvancedWithoutTitleChange) {
        for (const [publisherId, liveTitle] of entry.liveTitlesByPublisher) {
          if (compareAuthorityVersions(version, liveTitle.baselineVersion) <= 0) continue;
          entry.liveTitlesByPublisher.set(publisherId, {
            ...liveTitle,
            baselineVersion: version,
          });
        }
      }
      if (
        entry.retainedLiveTitle &&
        canonicalMaterializesLiveTitle(entry.canonicalTitle, entry.retainedLiveTitle)
      ) {
        entry.retainedLiveTitle = undefined;
      }
      notifyIfChanged(entry, previousTitle);
    },
    publishLive: (resourceKey, publisherId, title, baselineVersion) => {
      const entry = getOrCreateEntry(resourceKey);
      touch(entry);
      const current = entry.liveTitlesByPublisher.get(publisherId);
      if (
        current?.title === title &&
        compareAuthorityVersions(current.baselineVersion, baselineVersion) === 0
      )
        return;

      const previousTitle = readEntryTitle(entry);
      revision += 1;
      const liveTitle = { title, revision, baselineVersion };
      entry.liveTitlesByPublisher.set(publisherId, liveTitle);
      entry.retainedLiveTitle = undefined;
      notifyIfChanged(entry, previousTitle);
    },
    releasePublisher,
  };
}
