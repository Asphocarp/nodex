import { resolveWorkbenchPanelTabAfterClose } from "../../shared/workbench-panel-layout";
import {
  resolveWorkbenchPanelTabOpenerCloseReplacement,
  type WorkbenchPanelTabOpenerState,
} from "./workbench-panel-tab-opener-state";

export interface PanelTabCloseRoutingTab {
  id: string;
  disabled?: boolean;
  isLabel?: boolean;
}

export interface PanelTabCloseRoutingInput {
  tabs: readonly PanelTabCloseRoutingTab[];
  activeTabId: string | null;
  closingTabId: string;
  openerState?: WorkbenchPanelTabOpenerState;
}

function isSelectableCloseReplacement(tab: PanelTabCloseRoutingTab): boolean {
  return tab.disabled !== true && tab.isLabel !== true;
}

export function resolvePanelTabCloseReplacement(input: PanelTabCloseRoutingInput): string | null {
  const selectableTabIds = input.tabs.filter(isSelectableCloseReplacement).map((tab) => tab.id);
  const candidates = new Set(selectableTabIds.filter((tabId) => tabId !== input.closingTabId));
  if (candidates.size === 0) return null;

  if (
    input.activeTabId &&
    input.activeTabId !== input.closingTabId &&
    candidates.has(input.activeTabId)
  ) {
    return input.activeTabId;
  }

  const openerReplacement = input.openerState
    ? resolveWorkbenchPanelTabOpenerCloseReplacement(
        input.openerState,
        selectableTabIds,
        input.closingTabId,
      )
    : null;
  if (openerReplacement && candidates.has(openerReplacement)) return openerReplacement;

  const adjacent = resolveWorkbenchPanelTabAfterClose(selectableTabIds, input.closingTabId);
  if (adjacent) return adjacent;

  return [...candidates][0] ?? null;
}
