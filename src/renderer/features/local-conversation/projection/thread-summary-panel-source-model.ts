import type {
  CodexConversationItem,
  CodexConversationTurn,
  CodexMcpToolCallView,
} from "../../../lib/types";
import type { ThreadMcpAppSidePanelInput } from "../thread-stage-types";
import {
  buildMcpAppSidePanelInput,
  resolveMcpEmbeddedRenderableResource,
} from "../view/shared/tools/mcp-tool-call-resource-utils";

export type ThreadSummaryPanelSourceKind = "tool" | "webPage" | "webSearch";

export type ThreadSummaryPanelSourceOpenAction = {
  type: "url";
  url: string;
} | {
  type: "mcpApp";
  input: ThreadMcpAppSidePanelInput;
};

export interface ThreadSummaryPanelSourceItem {
  id: string;
  kind: ThreadSummaryPanelSourceKind;
  label: string;
  logoUrl: string | null;
  logoUrlDark: string | null;
  mcpAppTarget: ThreadSummaryPanelMcpAppSourceTarget | null;
  openAction: ThreadSummaryPanelSourceOpenAction | null;
}

export interface ThreadSummaryPanelMcpAppSourceTarget {
  threadId: string;
  payload: CodexMcpToolCallView;
}

export interface ThreadSummaryPanelSourceModel {
  items: ThreadSummaryPanelSourceItem[];
  count: number;
}

interface McpSourceDraft {
  id: string;
  label: string;
  logoUrl: string | null;
  logoUrlDark: string | null;
  mcpAppTarget: ThreadSummaryPanelMcpAppSourceTarget | null;
  openAction: ThreadSummaryPanelSourceOpenAction | null;
}

interface WebPageSourceDraft {
  url: string;
  label: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const trimmed = trimNonEmptyString(value);
    if (trimmed) return trimmed;
  }
  return null;
}

function humanizeIdentifier(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function formatMcpSourceLabel(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "context7") return "Context7";

  const humanized = humanizeIdentifier(trimmed);
  return humanized.length > 0 ? humanized : trimmed;
}

function isMcpToolCallItem(item: CodexConversationItem): boolean {
  return item.type === "mcpToolCall" || item.semanticKind === "mcpToolCall";
}

function isWebSearchItem(item: CodexConversationItem): boolean {
  return item.type === "webSearch" || item.semanticKind === "webSearch";
}

function getMcpServerName(item: CodexConversationItem): string | null {
  const rawItem = asRecord(item.rawItem);
  const rawInvocation = asRecord(rawItem?.invocation);
  return getFirstString(
    item.mcpToolCall?.invocation.server,
    item.toolCall?.server,
    rawItem?.server,
    rawInvocation?.server,
  );
}

function getMcpLogoMetadata(item: CodexConversationItem): {
  logoUrl: string | null;
  logoUrlDark: string | null;
} {
  const rawItem = asRecord(item.rawItem);
  const toolCall = asRecord(item.toolCall);
  const candidates = [
    rawItem,
    asRecord(rawItem?.source),
    asRecord(rawItem?.server),
    asRecord(rawItem?.app),
    asRecord(rawItem?.connector),
    asRecord(rawItem?.plugin),
    asRecord(rawItem?.meta),
    asRecord(rawItem?.metadata),
    toolCall,
    asRecord(toolCall?.source),
    asRecord(toolCall?.server),
    asRecord(toolCall?.app),
    asRecord(toolCall?.connector),
    asRecord(toolCall?.plugin),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const logoUrl = getFirstString(
      candidate.logoUrl,
      candidate.logo_url,
      candidate.logoPath,
      candidate.logo_path,
    );
    const logoUrlDark = getFirstString(
      candidate.logoUrlDark,
      candidate.logoDarkUrl,
      candidate.logo_url_dark,
      candidate.logo_dark_url,
      candidate.logoDarkURL,
    );
    if (logoUrl || logoUrlDark) return { logoUrl, logoUrlDark };
  }

  return { logoUrl: null, logoUrlDark: null };
}

function resolveMcpAppRecord(item: CodexConversationItem): Record<string, unknown> | null {
  const rawItem = asRecord(item.rawItem);
  const candidates = [
    asRecord(rawItem?.app),
    asRecord(rawItem?.connector),
    asRecord(rawItem?.plugin),
    asRecord(rawItem?.appContext),
    asRecord(rawItem?.source),
    asRecord(item.toolCall),
  ];

  return candidates.find((candidate) => {
    if (!candidate) return false;
    return getFirstString(
      candidate.id,
      candidate.appId,
      candidate.connectorId,
      candidate.pluginId,
      candidate.name,
    ) !== null;
  }) ?? null;
}

function resolveMcpAppSourceTarget(item: CodexConversationItem): ThreadSummaryPanelMcpAppSourceTarget | null {
  const payload = item.mcpToolCall;
  const threadId = trimNonEmptyString(item.threadId);
  if (!payload || !threadId) return null;

  return { threadId, payload };
}

function resolveMcpSourceOpenAction(
  target: ThreadSummaryPanelMcpAppSourceTarget | null,
): ThreadSummaryPanelSourceOpenAction | null {
  if (!target) return null;

  const resource = resolveMcpEmbeddedRenderableResource({ payload: target.payload });
  if (!resource) return null;

  return {
    type: "mcpApp",
    input: buildMcpAppSidePanelInput({
      threadId: target.threadId,
      payload: target.payload,
      resource,
    }),
  };
}

function resolveMcpSourceDraft(item: CodexConversationItem): McpSourceDraft | null {
  const serverName = getMcpServerName(item);
  if (!serverName || serverName === "node_repl") return null;

  const logoMetadata = getMcpLogoMetadata(item);
  const mcpAppTarget = resolveMcpAppSourceTarget(item);
  const openAction = resolveMcpSourceOpenAction(mcpAppTarget);
  const rawSource = asRecord(asRecord(item.rawItem)?.source);
  const rawSourceKey = rawSource
    ? getFirstString(rawSource.groupKey, rawSource.key, rawSource.id)
    : null;
  if (rawSource && rawSourceKey) {
    const sourceName = getFirstString(rawSource.name, rawSource.displayName, rawSource.title)
      ?? formatMcpSourceLabel(rawSourceKey);
    return {
      id: rawSourceKey,
      label: sourceName,
      ...logoMetadata,
      mcpAppTarget,
      openAction,
    };
  }

  const appRecord = resolveMcpAppRecord(item);
  const appId = appRecord
    ? getFirstString(appRecord.id, appRecord.appId, appRecord.connectorId, appRecord.pluginId)
    : null;
  if (appRecord && appId) {
    const appName = getFirstString(appRecord.name, appRecord.displayName, appRecord.title)
      ?? formatMcpSourceLabel(appId);
    return {
      id: appId,
      label: appName,
      ...logoMetadata,
      mcpAppTarget,
      openAction,
    };
  }

  const pluginId = getFirstString(item.mcpToolCall?.pluginId, asRecord(item.rawItem)?.pluginId);
  if (pluginId) {
    return {
      id: pluginId,
      label: formatMcpSourceLabel(serverName),
      ...logoMetadata,
      mcpAppTarget,
      openAction,
    };
  }

  return {
    id: `mcp-server:${serverName}`,
    label: formatMcpSourceLabel(serverName),
    ...logoMetadata,
    mcpAppTarget,
    openAction,
  };
}

function collectToolSources(turns: readonly CodexConversationTurn[]): ThreadSummaryPanelSourceItem[] {
  const sources = new Map<string, ThreadSummaryPanelSourceItem>();

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn) continue;

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!item || !isMcpToolCallItem(item)) continue;

      const source = resolveMcpSourceDraft(item);
      if (!source) continue;

      const existingSource = sources.get(source.id);
      if (existingSource) {
        if (
          (!existingSource.openAction && source.openAction)
          || (!existingSource.mcpAppTarget && source.mcpAppTarget)
        ) {
          sources.set(source.id, {
            ...existingSource,
            mcpAppTarget: existingSource.mcpAppTarget ?? source.mcpAppTarget,
            openAction: existingSource.openAction ?? source.openAction,
          });
        }
        continue;
      }

      sources.set(source.id, {
        id: source.id,
        kind: "tool",
        label: source.label,
        logoUrl: source.logoUrl,
        logoUrlDark: source.logoUrlDark,
        mcpAppTarget: source.mcpAppTarget,
        openAction: source.openAction,
      });
    }
  }

  return [...sources.values()];
}

function resolveWebSearchAction(item: CodexConversationItem): unknown {
  const rawItem = asRecord(item.rawItem);
  if (rawItem && Object.prototype.hasOwnProperty.call(rawItem, "action")) {
    return rawItem.action;
  }

  return item.toolCall?.result;
}

function parseReferenceWebUrl(value: unknown): URL | null {
  const rawUrl = trimNonEmptyString(value);
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function resolveWebPageSource(action: unknown): WebPageSourceDraft | null {
  const record = asRecord(action);
  const actionType = trimNonEmptyString(record?.type);
  if (actionType !== "openPage" && actionType !== "findInPage") return null;

  const url = parseReferenceWebUrl(record?.url);
  if (!url) return null;

  return {
    url: url.href,
    label: `${url.hostname.replace(/^www\./iu, "")}${url.pathname}`,
  };
}

function collectWebSources(turns: readonly CodexConversationTurn[]): ThreadSummaryPanelSourceItem[] {
  const pageSources = new Map<string, ThreadSummaryPanelSourceItem>();
  let sawWebSearch = false;

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn) continue;

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!item || !isWebSearchItem(item)) continue;
      sawWebSearch = true;

      const page = resolveWebPageSource(resolveWebSearchAction(item));
      if (!page || pageSources.has(page.url)) continue;

      pageSources.set(page.url, {
        id: `web-page:${page.url}`,
        kind: "webPage",
        label: page.label,
        logoUrl: null,
        logoUrlDark: null,
        mcpAppTarget: null,
        openAction: {
          type: "url",
          url: page.url,
        },
      });
    }
  }

  const pages = [...pageSources.values()];
  if (pages.length > 0) return pages;
  if (!sawWebSearch) return [];

  return [{
    id: "web-search",
    kind: "webSearch",
    label: "Web search",
    logoUrl: null,
    logoUrlDark: null,
    mcpAppTarget: null,
    openAction: null,
  }];
}

export function buildThreadSummaryPanelSourceModel(
  turns: readonly CodexConversationTurn[],
): ThreadSummaryPanelSourceModel {
  const items = [
    ...collectToolSources(turns),
    ...collectWebSources(turns),
  ];

  return {
    items,
    count: items.length,
  };
}
