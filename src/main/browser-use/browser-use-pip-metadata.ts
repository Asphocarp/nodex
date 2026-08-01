export type BrowserUsePipBackend = "cdp" | "chrome" | "iab";

export interface BrowserUsePipSurface {
  backend: BrowserUsePipBackend;
  browserId: string;
  openTabIds?: string[];
  screenshot?: {
    tabId: string;
    url: string;
  };
  sessionEnded?: true;
}

export type RemoteHostedPipNotification =
  | { kind: "browser-use"; surface: BrowserUsePipSurface; threadId: string }
  | { kind: "thread-ended"; threadId: string }
  | { kind: "turn-ended"; completed: boolean; threadId: string; turnId: string };

const MAX_IDENTIFIER_LENGTH = 1_024;
const MAX_SCREENSHOT_DATA_URL_LENGTH = 32 * 1024 * 1024;
const MAX_OPEN_TAB_IDS = 256;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  if (parsed.length === 0 || parsed.length > MAX_IDENTIFIER_LENGTH) return null;
  return parsed;
}

function parseBrowserUseSurface(value: unknown): BrowserUsePipSurface | null {
  const surface = asRecord(value);
  if (!surface || surface.kind !== "browserUse") return null;
  if (surface.backend !== "cdp" && surface.backend !== "chrome" && surface.backend !== "iab") {
    return null;
  }
  const browserId = parseIdentifier(surface.browserId);
  if (!browserId) return null;

  let openTabIds: string[] | undefined;
  if (surface.openTabIds !== undefined) {
    if (!Array.isArray(surface.openTabIds) || surface.openTabIds.length > MAX_OPEN_TAB_IDS) {
      return null;
    }
    const parsed = surface.openTabIds.map(parseIdentifier);
    if (parsed.some((entry) => entry === null)) return null;
    openTabIds = parsed as string[];
    if (new Set(openTabIds).size !== openTabIds.length) return null;
  }

  let screenshot: BrowserUsePipSurface["screenshot"];
  if (surface.screenshot !== undefined) {
    const value = asRecord(surface.screenshot);
    const tabId = parseIdentifier(value?.tabId);
    const url = value?.url;
    if (
      !tabId
      || typeof url !== "string"
      || !url.startsWith("data:image/")
      || url.length > MAX_SCREENSHOT_DATA_URL_LENGTH
    ) {
      return null;
    }
    screenshot = { tabId, url };
  }

  if (surface.sessionEnded !== undefined && surface.sessionEnded !== true) return null;
  return {
    backend: surface.backend,
    browserId,
    ...(openTabIds ? { openTabIds } : {}),
    ...(screenshot ? { screenshot } : {}),
    ...(surface.sessionEnded === true ? { sessionEnded: true } : {}),
  };
}

export function parseRemoteHostedPipNotification(
  value: unknown,
): RemoteHostedPipNotification | null {
  const notification = asRecord(value);
  const params = asRecord(notification?.params);
  const method = notification?.method;
  const threadId = parseIdentifier(params?.threadId);
  if (!threadId || typeof method !== "string") return null;

  if (method === "thread/archived" || method === "thread/closed") {
    return { kind: "thread-ended", threadId };
  }

  if (method === "turn/completed") {
    const turn = asRecord(params?.turn);
    const turnId = parseIdentifier(turn?.id);
    if (!turnId) return null;
    return {
      completed: turn?.status === "completed",
      kind: "turn-ended",
      threadId,
      turnId,
    };
  }

  if (method !== "item/completed") return null;
  const item = asRecord(params?.item);
  if (item?.type !== "mcpToolCall" || item.server !== "node_repl") return null;
  const result = asRecord(item.result);
  const metadata = asRecord(result?._meta);
  const surface = parseBrowserUseSurface(metadata?.["codex/toolSurface"]);
  return surface ? { kind: "browser-use", surface, threadId } : null;
}
