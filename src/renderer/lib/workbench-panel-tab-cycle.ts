import type { WorkbenchPanelTabCycleDirection } from "../../shared/window-navigation";
import type { WorkbenchPanelTabShortcutItem } from "./workbench-panel-tab-shortcut";
import {
  createCommandKeymapState,
  getCommandEntry,
  matchesKeyboardEventToCommand,
  type CommandKeymapState,
  NEXT_PANEL_TAB_COMMAND_ID,
  PREVIOUS_PANEL_TAB_COMMAND_ID,
} from "../../shared/command-keybindings";

export type PanelTabCycleDirection = -1 | 1;

export function resolvePanelTabCycleDirection(
  event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  isMac: boolean,
  commandKeymapState?: CommandKeymapState | null,
): PanelTabCycleDirection | null {
  const state = commandKeymapState ?? createCommandKeymapState({}, isMac ? "macOS" : "windows");
  const previousEntry = getCommandEntry(state, PREVIOUS_PANEL_TAB_COMMAND_ID);
  const nextEntry = getCommandEntry(state, NEXT_PANEL_TAB_COMMAND_ID);
  if (matchesKeyboardEventToCommand(event, state, PREVIOUS_PANEL_TAB_COMMAND_ID)) {
    return -1;
  }
  if (matchesKeyboardEventToCommand(event, state, NEXT_PANEL_TAB_COMMAND_ID)) {
    return 1;
  }

  const modifier = isMac ? event.metaKey : event.ctrlKey;
  if (!modifier || event.altKey || !event.shiftKey) return null;
  if (event.code === "BracketLeft" || event.key === "[" || event.key === "{") {
    if (previousEntry?.isCustom === true) return null;
    return -1;
  }
  if (event.code === "BracketRight" || event.key === "]" || event.key === "}") {
    if (nextEntry?.isCustom === true) return null;
    return 1;
  }
  return null;
}

export function resolvePanelTabCloseShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  isMac: boolean,
  commandKeymapState?: CommandKeymapState | null,
): boolean {
  const state = commandKeymapState ?? createCommandKeymapState({}, isMac ? "macOS" : "windows");
  const closeEntry = getCommandEntry(state, "closeTab");
  if (matchesKeyboardEventToCommand(event, state, "closeTab")) return true;
  if (closeEntry?.isCustom === true) return false;

  const modifier = isMac ? event.metaKey : event.ctrlKey;
  return modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "w";
}

export function resolveNextPanelTabId(
  tabs: readonly WorkbenchPanelTabShortcutItem[],
  activeTabId: string | null,
  direction: PanelTabCycleDirection,
): string | null {
  if (tabs.length <= 1) return null;
  if (!activeTabId) return null;

  const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  if (currentIndex < 0) return null;

  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  return tabs[nextIndex]?.id ?? null;
}

export function panelTabCycleRequestDirectionToOffset(
  direction: WorkbenchPanelTabCycleDirection,
): PanelTabCycleDirection {
  return direction === "previous" ? -1 : 1;
}
