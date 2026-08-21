export interface PanelTabCloseRoutingTab {
  id: string;
  disabled?: boolean;
  isLabel?: boolean;
}

export interface PanelTabCloseRoutingInput {
  tabs: readonly PanelTabCloseRoutingTab[];
  activeTabId: string | null;
  closingTabId: string;
  mruTabIds?: readonly string[];
}

function isSelectableCloseReplacement(tab: PanelTabCloseRoutingTab): boolean {
  return tab.disabled !== true && tab.isLabel !== true;
}

function resolveAdjacentCloseReplacement(
  tabs: readonly PanelTabCloseRoutingTab[],
  closingIndex: number,
  closingTabId: string,
): string | null {
  for (let index = Math.max(0, closingIndex + 1); index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (!tab || tab.id === closingTabId || !isSelectableCloseReplacement(tab)) continue;
    return tab.id;
  }

  const leftStartIndex = closingIndex === -1 ? tabs.length - 1 : closingIndex - 1;
  for (let index = leftStartIndex; index >= 0; index -= 1) {
    const tab = tabs[index];
    if (!tab || tab.id === closingTabId || !isSelectableCloseReplacement(tab)) continue;
    return tab.id;
  }

  return null;
}

export function resolvePanelTabCloseReplacement(input: PanelTabCloseRoutingInput): string | null {
  const candidates = new Set(
    input.tabs
      .filter((tab) => tab.id !== input.closingTabId && isSelectableCloseReplacement(tab))
      .map((tab) => tab.id),
  );
  if (candidates.size === 0) return null;

  if (
    input.activeTabId &&
    input.activeTabId !== input.closingTabId &&
    candidates.has(input.activeTabId)
  ) {
    return input.activeTabId;
  }

  for (const tabId of input.mruTabIds ?? []) {
    if (tabId === input.closingTabId) continue;
    if (candidates.has(tabId)) return tabId;
  }

  const closingIndex = input.tabs.findIndex((tab) => tab.id === input.closingTabId);
  const adjacent = resolveAdjacentCloseReplacement(input.tabs, closingIndex, input.closingTabId);
  if (adjacent) return adjacent;

  return [...candidates][0] ?? null;
}
