import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarStateSnapshot,
} from "../../shared/browser-sidebar";
import { makeBrowserSidebarConversationScopeKey } from "../../shared/browser-sidebar";
import type { ProjectSession } from "../../shared/types";

export interface CodexOrdinaryBrowserTransferCapture {
  readonly browserTransferSourceBrowserTabId: string;
  readonly browserTransferSourceBrowserTabIds: readonly string[];
  readonly browserTransferSourceConversationId: string;
  readonly browserTransferSourceViewScopeId: string;
}

interface CaptureCodexOrdinaryBrowserTransferInput {
  readonly browserState: BrowserSidebarStateSnapshot;
  readonly browserUseState: BrowserSidebarBrowserUseStateSnapshot;
  readonly enabled: boolean;
  readonly session: ProjectSession;
  readonly browserViewScopeId: string;
}

function appendFirst(
  orderedIds: string[],
  seenIds: Set<string>,
  browserTabId: string | null | undefined,
): void {
  const normalizedId = browserTabId?.trim() ?? "";
  if (!normalizedId || seenIds.has(normalizedId)) return;
  seenIds.add(normalizedId);
  orderedIds.push(normalizedId);
}

/**
 * Exact ordinary Home-composer capture. In 26.707 these fields are frozen request
 * metadata only; stable client/session identity, not a pending-entry consumer,
 * preserves the browser owner through realization.
 */
export function captureCodexOrdinaryBrowserTransfer(
  input: CaptureCodexOrdinaryBrowserTransferInput,
): CodexOrdinaryBrowserTransferCapture | null {
  if (!input.enabled || input.session.thread !== null) return null;

  const orderedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const tab of input.browserState.tabs) {
    if (tab.browserConversationId !== input.session.id) continue;
    if (tab.browserViewScopeId !== input.browserViewScopeId) continue;
    appendFirst(orderedIds, seenIds, tab.browserTabId);
  }
  for (const tab of input.browserUseState.tabs) {
    if (tab.browserConversationId !== input.session.id) continue;
    if (tab.browserViewScopeId !== input.browserViewScopeId) continue;
    appendFirst(orderedIds, seenIds, tab.browserTabId);
  }

  const rememberedBrowserTabId =
    input.browserUseState.activeBrowserTabIdsByConversationScope[
      makeBrowserSidebarConversationScopeKey({
        browserConversationId: input.session.id,
        browserViewScopeId: input.browserViewScopeId,
      })
    ] ?? null;
  const selectedBrowserTabId =
    rememberedBrowserTabId !== null && seenIds.has(rememberedBrowserTabId)
      ? rememberedBrowserTabId
      : (orderedIds.at(-1) ?? null);
  if (selectedBrowserTabId === null || !seenIds.has(selectedBrowserTabId)) return null;

  return {
    browserTransferSourceBrowserTabId: selectedBrowserTabId,
    browserTransferSourceBrowserTabIds: [...orderedIds],
    browserTransferSourceConversationId: input.session.id,
    browserTransferSourceViewScopeId: input.browserViewScopeId,
  };
}
