import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarStateSnapshot,
} from "../../shared/browser-sidebar";
import { requireProjectSessionBrowserTabId } from "../../shared/browser-sidebar";
import { getProjectSessionPanelActiveLeaf } from "../../shared/project-session-panel-layout";
import type { PanelId, ProjectSession, ProjectSessionTab } from "../../shared/types";

export interface CodexOrdinaryBrowserTransferCapture {
  readonly browserTransferSourceBrowserTabId: string;
  readonly browserTransferSourceBrowserTabIds: readonly string[];
  readonly browserTransferSourceConversationId: string;
}

interface CaptureCodexOrdinaryBrowserTransferInput {
  readonly browserState: BrowserSidebarStateSnapshot;
  readonly browserUseState: BrowserSidebarBrowserUseStateSnapshot;
  readonly enabled: boolean;
  readonly session: ProjectSession;
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

function browserTabsInPanel(
  session: ProjectSession,
  panelId: PanelId,
): readonly ProjectSessionTab[] {
  return session.tabs.filter((tab) => tab.panelId === panelId && tab.kind === "browser");
}

function activeBrowserTabId(
  session: ProjectSession,
  panelId: PanelId,
): string | null {
  const activeTabId = getProjectSessionPanelActiveLeaf(
    session.panels[panelId].layout,
  ).activeTabId;
  if (activeTabId === null) return null;
  const activeTab = session.tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab || activeTab.kind !== "browser") return null;
  return requireProjectSessionBrowserTabId(activeTab);
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
  for (const panelId of ["right", "bottom"] as const) {
    for (const tab of browserTabsInPanel(input.session, panelId)) {
      appendFirst(orderedIds, seenIds, requireProjectSessionBrowserTabId(tab));
    }
  }
  for (const tab of input.browserState.tabs) {
    if (tab.browserConversationId !== input.session.id) continue;
    appendFirst(orderedIds, seenIds, tab.browserTabId);
  }
  for (const tab of input.browserUseState.tabs) {
    if (tab.browserConversationId !== input.session.id) continue;
    appendFirst(orderedIds, seenIds, tab.browserTabId);
  }

  const rememberedBrowserTabId =
    input.browserUseState.activeBrowserTabIdsByConversation[input.session.id] ?? null;
  const selectedBrowserTabId = (
    rememberedBrowserTabId !== null && seenIds.has(rememberedBrowserTabId)
      ? rememberedBrowserTabId
      : activeBrowserTabId(input.session, "right")
        ?? activeBrowserTabId(input.session, "bottom")
        ?? orderedIds.at(-1)
        ?? null
  );
  if (selectedBrowserTabId === null || !seenIds.has(selectedBrowserTabId)) return null;

  return {
    browserTransferSourceBrowserTabId: selectedBrowserTabId,
    browserTransferSourceBrowserTabIds: [...orderedIds],
    browserTransferSourceConversationId: input.session.id,
  };
}
