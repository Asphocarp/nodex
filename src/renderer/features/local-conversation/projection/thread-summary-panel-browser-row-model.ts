import type { PanelId } from "../../../lib/types";
import type { ThreadSummaryPanelBrowserRow } from "../thread-stage-types";

const BROWSER_ATTACH_TOKEN_URL_PREFIX = "about:blank#codex-browser-sidebar-attach-token=";

export interface ThreadSummaryPanelBrowserRowInput {
  id: string;
  tabTitle: string;
  configTitle?: string | null;
  url?: string | null;
  faviconUrl?: string | null;
  isAgentWorking?: boolean;
  panelId?: PanelId;
  leafId?: string | null;
}

export function buildThreadSummaryPanelBrowserRow(
  input: ThreadSummaryPanelBrowserRowInput,
): ThreadSummaryPanelBrowserRow {
  const rawUrl = input.url?.trim() ?? "";
  const displayUrl = isHiddenBrowserSummaryUrl(rawUrl) ? null : resolveBrowserSummaryDisplayUrl(rawUrl);
  const titleSource = input.configTitle?.trim() || input.tabTitle;
  const title = displayUrl ? resolveBrowserSummaryTitle(titleSource, displayUrl) : resolveBlankBrowserSummaryTitle(titleSource);
  const faviconUrl = input.faviconUrl?.trim() ?? "";

  return {
    id: input.id,
    title,
    displayUrl,
    url: isBrowserAttachTokenUrl(rawUrl) ? "" : rawUrl,
    faviconUrl: faviconUrl.length > 0 ? faviconUrl : null,
    isAgentWorking: input.isAgentWorking === true,
    panelId: input.panelId,
    leafId: input.leafId ?? null,
  };
}

export function isThreadSummaryBrowserRowAgentWorking(
  activeBrowserUseTabId: string | null | undefined,
  browserTabId: string,
): boolean {
  return activeBrowserUseTabId === browserTabId;
}

function isHiddenBrowserSummaryUrl(url: string): boolean {
  return url.length === 0 || url === "about:blank" || isBrowserAttachTokenUrl(url);
}

function isBrowserAttachTokenUrl(url: string): boolean {
  return url.startsWith(BROWSER_ATTACH_TOKEN_URL_PREFIX);
}

function resolveBlankBrowserSummaryTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return "Browser";
  if (trimmed === "about:blank") return "Browser";
  if (trimmed.startsWith(BROWSER_ATTACH_TOKEN_URL_PREFIX)) return "Browser";
  return trimmed;
}

function resolveBrowserSummaryTitle(title: string, displayUrl: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return displayUrl;
  if (trimmed === "New tab") return displayUrl;
  if (trimmed === "about:blank") return displayUrl;
  if (trimmed.startsWith(BROWSER_ATTACH_TOKEN_URL_PREFIX)) return displayUrl;
  return trimmed;
}

function resolveBrowserSummaryDisplayUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./u, "");
  } catch {
    return url.replace(/^https?:\/\//u, "");
  }
}
