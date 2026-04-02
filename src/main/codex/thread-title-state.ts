import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CODEX_THREAD_TITLE_CACHE_LIMIT,
  emptyCodexThreadTitleCacheState,
  normalizeCodexThreadTitleCacheState,
  type CodexThreadTitleCacheState,
  upsertCodexThreadTitleCacheState,
} from "../../shared/codex-thread-title";

const THREAD_TITLE_STATE_FILE_NAME = "codex-thread-titles-v1.json";

interface PersistedThreadTitleState {
  version: 1;
  cache: CodexThreadTitleCacheState;
  pendingBackfill: CodexThreadTitleCacheState;
}

function emptyPersistedState(): PersistedThreadTitleState {
  return {
    version: 1,
    cache: emptyCodexThreadTitleCacheState(),
    pendingBackfill: emptyCodexThreadTitleCacheState(),
  };
}

function normalizePersistedThreadTitleState(value: unknown): PersistedThreadTitleState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return emptyPersistedState();
  }

  const candidate = value as {
    version?: unknown;
    cache?: unknown;
    pendingBackfill?: unknown;
  };

  if (candidate.version !== 1) {
    return emptyPersistedState();
  }

  return {
    version: 1,
    cache: normalizeCodexThreadTitleCacheState(candidate.cache, CODEX_THREAD_TITLE_CACHE_LIMIT),
    pendingBackfill: normalizeCodexThreadTitleCacheState(candidate.pendingBackfill, CODEX_THREAD_TITLE_CACHE_LIMIT),
  };
}

export class CodexThreadTitleStateStore {
  private readonly statePath: string;
  private state: PersistedThreadTitleState | null = null;

  constructor(rootPath: string) {
    this.statePath = join(rootPath, THREAD_TITLE_STATE_FILE_NAME);
  }

  readCache(): CodexThreadTitleCacheState {
    return this.readState().cache;
  }

  readPendingBackfill(): CodexThreadTitleCacheState {
    return this.readState().pendingBackfill;
  }

  readCachedTitle(threadId: string): string | null {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return null;
    return this.readState().cache.titles[normalizedThreadId] ?? null;
  }

  setTitle(threadId: string, title: string): CodexThreadTitleCacheState {
    const current = this.readState();
    const nextState: PersistedThreadTitleState = {
      version: 1,
      cache: upsertCodexThreadTitleCacheState(current.cache, threadId, title, CODEX_THREAD_TITLE_CACHE_LIMIT),
      pendingBackfill: upsertCodexThreadTitleCacheState(
        current.pendingBackfill,
        threadId,
        title,
        CODEX_THREAD_TITLE_CACHE_LIMIT,
      ),
    };
    this.writeState(nextState);
    return nextState.cache;
  }

  clearPendingBackfill(threadIds: readonly string[]): void {
    if (threadIds.length === 0) return;
    const state = this.readState();
    const removedIds = new Set(threadIds.map((threadId) => threadId.trim()).filter(Boolean));
    if (removedIds.size === 0) return;

    const pendingBackfill: CodexThreadTitleCacheState = {
      titles: { ...state.pendingBackfill.titles },
      order: state.pendingBackfill.order.filter((threadId) => !removedIds.has(threadId)),
    };
    for (const threadId of removedIds) {
      delete pendingBackfill.titles[threadId];
    }

    this.writeState({
      ...state,
      pendingBackfill,
    });
  }

  private readState(): PersistedThreadTitleState {
    if (this.state) {
      return this.state;
    }

    try {
      const raw = readFileSync(this.statePath, "utf8");
      this.state = normalizePersistedThreadTitleState(JSON.parse(raw));
    } catch {
      this.state = emptyPersistedState();
    }
    return this.state;
  }

  private writeState(nextState: PersistedThreadTitleState): void {
    this.state = nextState;
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(nextState, null, 2), "utf8");
  }
}
