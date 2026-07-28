import type { AppShellTabItem } from "@/components/workbench/app-shell-tabs";
import type { WorkbenchPanelTabCycleDirection } from "../../shared/window-navigation";

export type PanelTabCycleDirection = -1 | 1;

export function resolvePanelTabCycleDirection(
  event: Pick<
    KeyboardEvent,
    "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
  isMac: boolean,
): PanelTabCycleDirection | null {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  if (!modifier || event.altKey || !event.shiftKey) return null;
  if (
    event.code === "BracketLeft"
    || event.key === "["
    || event.key === "{"
  ) {
    return -1;
  }
  if (
    event.code === "BracketRight"
    || event.key === "]"
    || event.key === "}"
  ) {
    return 1;
  }
  return null;
}

export function resolvePanelTabCloseShortcut(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
  isMac: boolean,
): boolean {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  return modifier
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === "w";
}

export function resolveNextPanelTabId(
  tabs: readonly AppShellTabItem[],
  activeTabId: string | null,
  direction: PanelTabCycleDirection,
): string | null {
  if (tabs.length <= 1) return null;
  if (!activeTabId) return null;

  const currentIndex = tabs.findIndex(
    (tab) => tab.id === activeTabId,
  );
  if (currentIndex < 0) return null;

  const nextIndex =
    (currentIndex + direction + tabs.length) % tabs.length;
  return tabs[nextIndex]?.id ?? null;
}

export function panelTabCycleRequestDirectionToOffset(
  direction: WorkbenchPanelTabCycleDirection,
): PanelTabCycleDirection {
  return direction === "previous" ? -1 : 1;
}
