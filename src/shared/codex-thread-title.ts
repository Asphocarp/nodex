export interface CodexThreadTitleCacheState {
  titles: Record<string, string>;
  order: string[];
}

export const CODEX_THREAD_TITLE_CACHE_LIMIT = 200;
export const CODEX_THREAD_TITLE_PROMPT_MAX_CHARS = 2_000;

export function emptyCodexThreadTitleCacheState(): CodexThreadTitleCacheState {
  return {
    titles: {},
    order: [],
  };
}

export function normalizeCodexThreadTitleCacheState(
  value: unknown,
  limit = CODEX_THREAD_TITLE_CACHE_LIMIT,
): CodexThreadTitleCacheState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return emptyCodexThreadTitleCacheState();
  }

  const candidate = value as {
    titles?: unknown;
    order?: unknown;
  };

  const titles: Record<string, string> = {};
  if (typeof candidate.titles === "object" && candidate.titles !== null && !Array.isArray(candidate.titles)) {
    for (const [threadId, title] of Object.entries(candidate.titles)) {
      if (typeof threadId !== "string") continue;
      if (typeof title !== "string") continue;
      const normalizedTitle = title.trim();
      if (!normalizedTitle) continue;
      titles[threadId] = normalizedTitle;
    }
  }

  const order = Array.isArray(candidate.order)
    ? candidate.order.filter((threadId): threadId is string => typeof threadId === "string" && threadId in titles)
    : [];

  for (const threadId of Object.keys(titles)) {
    if (!order.includes(threadId)) {
      order.push(threadId);
    }
  }

  return trimCodexThreadTitleCacheState({
    titles,
    order,
  }, limit);
}

export function trimCodexThreadTitleCacheState(
  state: CodexThreadTitleCacheState,
  limit = CODEX_THREAD_TITLE_CACHE_LIMIT,
): CodexThreadTitleCacheState {
  if (state.order.length <= limit) {
    return state;
  }

  const titles = { ...state.titles };
  const order = state.order.slice(0, limit);
  const allowed = new Set(order);
  for (const threadId of Object.keys(titles)) {
    if (!allowed.has(threadId)) {
      delete titles[threadId];
    }
  }

  return {
    titles,
    order,
  };
}

export function upsertCodexThreadTitleCacheState(
  state: CodexThreadTitleCacheState,
  threadId: string,
  title: string,
  limit = CODEX_THREAD_TITLE_CACHE_LIMIT,
): CodexThreadTitleCacheState {
  const normalizedThreadId = threadId.trim();
  const normalizedTitle = title.trim();
  if (!normalizedThreadId || !normalizedTitle) {
    return state;
  }

  const nextOrder = [normalizedThreadId, ...state.order.filter((candidate) => candidate !== normalizedThreadId)];
  const nextState: CodexThreadTitleCacheState = {
    titles: {
      ...state.titles,
      [normalizedThreadId]: normalizedTitle,
    },
    order: nextOrder,
  };
  return trimCodexThreadTitleCacheState(nextState, limit);
}

function stripMarkdownLinks(value: string): string {
  return value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

export function sanitizeCodexThreadTitlePrompt(
  prompt: string,
  maxChars = CODEX_THREAD_TITLE_PROMPT_MAX_CHARS,
): string {
  const normalizedPrompt = stripMarkdownLinks(prompt).replace(/\s+/g, " ").trim();
  if (!normalizedPrompt) {
    return "";
  }

  if (normalizedPrompt.length <= maxChars) {
    return normalizedPrompt;
  }

  return normalizedPrompt.slice(0, maxChars).trimEnd();
}
