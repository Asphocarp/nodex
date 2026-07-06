import { useEffect, useMemo, useState } from "react";
import { invoke, subscribeCommandPaletteThreadIndexUpdates } from "./api";
import {
  filterCommandPaletteItems,
  prioritizeActiveProjectItems,
  type CommandPaletteThread,
} from "./command-palette";
import {
  buildCommandPaletteQueryHighlightPreview,
} from "./command-palette-highlight";
import { normalizeCommandPaletteSearchText } from "./command-palette-card-search";
import type {
  CommandPaletteThreadContentSearchResult,
  CommandPaletteThreadSummary,
} from "./types";
import type { CommandPaletteThreadSearchIndex } from "./command-palette-thread-search";

const DEFAULT_THREAD_LIMIT = 8;
const CONTENT_SEARCH_LIMIT = 60;
const INDEX_UPDATE_REFRESH_DELAY_MS = 250;

const commandPaletteThreadItemsCache = new Map<string, CommandPaletteThread[]>();

export interface CommandPaletteThreadItemsState {
  threads: CommandPaletteThread[];
  loading: boolean;
}

export interface CommandPaletteThreadContentSearchBatch {
  query: string;
  results: readonly CommandPaletteThreadContentSearchResult[];
  loading: boolean;
}

export function buildCommandPaletteThreadItem(
  summary: CommandPaletteThreadSummary,
  activeProjectId: string,
): CommandPaletteThread {
  return {
    kind: "thread",
    id: `thread:${summary.threadId}`,
    threadId: summary.threadId,
    sessionId: summary.sessionId,
    projectId: summary.projectId,
    projectName: summary.projectName,
    title: summary.title,
    preview: summary.preview,
    cwd: summary.cwd,
    projectless: summary.projectless,
    pinned: summary.pinned,
    pinnedOrder: summary.pinnedOrder,
    statusType: summary.statusType,
    statusActiveFlags: summary.statusActiveFlags,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    linkedAt: summary.linkedAt,
    inActiveProject: summary.projectId !== null && summary.projectId === activeProjectId,
  };
}

export async function listCommandPaletteThreadItems({
  activeProjectId,
}: {
  activeProjectId: string;
}): Promise<CommandPaletteThread[]> {
  try {
    const summaries = await invoke("codex:threads:palette:list", { scope: "sidebar" });
    return summaries.map((summary) => buildCommandPaletteThreadItem(summary, activeProjectId));
  } catch {
    return [];
  }
}

export function useCommandPaletteThreadItems({
  enabled,
  activeProjectId,
  refreshKey,
}: {
  enabled: boolean;
  activeProjectId: string;
  refreshKey: number;
}): CommandPaletteThreadItemsState {
  const [state, setState] = useState<CommandPaletteThreadItemsState>(() => ({
    threads: commandPaletteThreadItemsCache.get(activeProjectId) ?? [],
    loading: false,
  }));

  useEffect(() => {
    if (!enabled) {
      setState((current) => current.threads.length === 0 && !current.loading
        ? current
        : { threads: [], loading: false });
      return;
    }

    let cancelled = false;
    const cachedThreads = commandPaletteThreadItemsCache.get(activeProjectId);
    setState((current) => ({
      threads: cachedThreads ?? current.threads,
      loading: true,
    }));

    void listCommandPaletteThreadItems({ activeProjectId })
      .then((threads) => {
        if (cancelled) return;
        commandPaletteThreadItemsCache.set(activeProjectId, threads);
        setState({
          threads,
          loading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState((current) => ({ threads: current.threads, loading: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, enabled, refreshKey]);

  return state;
}

export function buildThreadContentSearchPreview(
  excerpt: string,
  query: string,
  segments?: CommandPaletteThreadContentSearchResult["snippetSegments"],
): CommandPaletteThread["searchPreview"] {
  const preview = segments && segments.length > 0
    ? {
      excerpt: excerpt.replace(/\s+/g, " ").trim(),
      segments,
    }
    : buildCommandPaletteQueryHighlightPreview(excerpt, query);
  if (!preview) return null;

  return {
    ...preview,
    source: "content",
  };
}

export async function searchCommandPaletteThreadContent({
  query,
  limit = CONTENT_SEARCH_LIMIT,
}: {
  query: string;
  limit?: number;
}): Promise<CommandPaletteThreadContentSearchResult[]> {
  const queryText = query.trimStart().trim();
  if (queryText.length < 2) return [];

  try {
    const results = await invoke("codex:threads:palette:search-content", {
      scope: "sidebar",
      query: queryText,
      limit,
    });
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

export function useCommandPaletteThreadContentSearch({
  enabled,
  query,
}: {
  enabled: boolean;
  query: string;
}): CommandPaletteThreadContentSearchBatch {
  const [batch, setBatch] = useState<CommandPaletteThreadContentSearchBatch>({
    query: "",
    results: [],
    loading: false,
  });
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeCommandPaletteThreadIndexUpdates(() => {
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        setRefreshTick((current) => current + 1);
      }, INDEX_UPDATE_REFRESH_DELAY_MS);
    });

    return () => {
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
      }
      unsubscribe();
    };
  }, [enabled]);

  useEffect(() => {
    const queryText = query.trimStart().trim();
    const normalizedQuery = normalizeCommandPaletteSearchText(queryText);
    if (!enabled || normalizedQuery.length < 2) {
      setBatch((current) => (
        current.query === "" && current.results.length === 0 && !current.loading
          ? current
          : { query: "", results: [], loading: false }
      ));
      return;
    }

    let cancelled = false;
    setBatch((current) => current.loading && current.query === normalizedQuery
      ? current
      : { ...current, loading: true });
    void searchCommandPaletteThreadContent({ query: queryText, limit: CONTENT_SEARCH_LIMIT })
      .then((nextResults) => {
        if (cancelled) return;
        setBatch({
          query: normalizedQuery,
          results: nextResults,
          loading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setBatch({
          query: normalizedQuery,
          results: [],
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, query, refreshTick]);

  return batch;
}

export function selectCommandPaletteChatResults({
  query,
  threads,
  threadSearchIndex,
  threadContentSearchBatch,
  threadLimit = DEFAULT_THREAD_LIMIT,
  preferActiveProject = false,
}: {
  query: string;
  threads: CommandPaletteThread[];
  threadSearchIndex?: CommandPaletteThreadSearchIndex | null;
  threadContentSearchBatch?: CommandPaletteThreadContentSearchBatch | null;
  threadLimit?: number;
  preferActiveProject?: boolean;
}): CommandPaletteThread[] {
  const results = filterCommandPaletteItems({
    query,
    mode: "chats",
    commands: [],
    cards: [],
    threads,
    threadSearchIndex,
    threadLimit,
    preferActiveProject,
  });

  const contentResults = threadContentSearchBatch
    && normalizeCommandPaletteSearchText(threadContentSearchBatch.query) === results.query
    ? threadContentSearchBatch.results
    : [];

  if (results.query.length === 0 || contentResults.length === 0) {
    return results.threads;
  }

  const threadById = new Map(threads.map((item) => [item.threadId, item] as const));
  const contentSearchThreads = contentResults.flatMap((result) => {
    const item = threadById.get(result.threadId);
    if (!item) return [];
    const searchPreview = buildThreadContentSearchPreview(result.snippet, results.query, result.snippetSegments);
    if (!searchPreview) return [];
    return [{
      ...item,
      searchPreview,
    }];
  });
  if (contentSearchThreads.length === 0) {
    return results.threads;
  }

  const contentMatchesById = new Map(contentSearchThreads.map((item) => [item.id, item] as const));
  const merged = results.threads.map((item) => {
    const contentMatch = contentMatchesById.get(item.id);
    if (!contentMatch?.searchPreview || item.searchPreview) {
      return item;
    }

    return {
      ...item,
      searchPreview: contentMatch.searchPreview,
    };
  });
  const seenIds = new Set(merged.map((item) => item.id));
  contentSearchThreads.forEach((item) => {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    merged.push(item);
  });

  return (preferActiveProject ? prioritizeActiveProjectItems(merged) : merged)
    .slice(0, threadLimit);
}

export function useSelectedCommandPaletteChatResults({
  query,
  threads,
  threadSearchIndex,
  threadContentSearchBatch,
  threadLimit,
  preferActiveProject,
}: {
  query: string;
  threads: CommandPaletteThread[];
  threadSearchIndex?: CommandPaletteThreadSearchIndex | null;
  threadContentSearchBatch?: CommandPaletteThreadContentSearchBatch | null;
  threadLimit?: number;
  preferActiveProject?: boolean;
}): CommandPaletteThread[] {
  return useMemo(
    () => selectCommandPaletteChatResults({
      query,
      threads,
      threadSearchIndex,
      threadContentSearchBatch,
      threadLimit,
      preferActiveProject,
    }),
    [preferActiveProject, query, threadContentSearchBatch, threadLimit, threadSearchIndex, threads],
  );
}
