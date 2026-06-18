export interface AppShellTabCloseModeTab {
  id: string;
  closable?: boolean;
  isLabel?: boolean;
}

export interface AppShellTabCloseModeMeasuredTab {
  id: string;
  width: number;
}

export interface AppShellTabCloseModeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface AppShellTabCloseModeSlop {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface AppShellTabCloseModeSnapshot {
  sourceTabId: string;
  sourceWidthPx: number;
  widthByTabId: Record<string, number>;
  runTabIds: string[];
  scrollLeft: number;
  hotZone: AppShellTabCloseModeRect;
  tabIdsSignature: string;
}

export const APP_SHELL_TAB_CLOSE_MODE_EXIT_DELAY_MS = 250;

export const APP_SHELL_TAB_CLOSE_MODE_HOT_ZONE_SLOP: AppShellTabCloseModeSlop = {
  top: 6,
  bottom: 40,
  left: 8,
  right: 60,
};

export function makeAppShellTabCloseModeTabIdsSignature(tabs: readonly AppShellTabCloseModeTab[]): string {
  return tabs.map((tab) => tab.id).join("\u001f");
}

export function buildAppShellTabCloseModeSnapshot({
  tabs,
  sourceTabId,
  measuredTabs,
  rowScrollLeft,
  rowRect,
  tabIdsSignature = makeAppShellTabCloseModeTabIdsSignature(tabs),
  hotZoneSlop = APP_SHELL_TAB_CLOSE_MODE_HOT_ZONE_SLOP,
}: {
  tabs: readonly AppShellTabCloseModeTab[];
  sourceTabId: string;
  measuredTabs: readonly AppShellTabCloseModeMeasuredTab[];
  rowScrollLeft: number;
  rowRect: AppShellTabCloseModeRect;
  tabIdsSignature?: string;
  hotZoneSlop?: AppShellTabCloseModeSlop;
}): AppShellTabCloseModeSnapshot | null {
  const sourceIndex = tabs.findIndex((tab) => tab.id === sourceTabId);
  if (sourceIndex < 0) return null;

  const sourceTab = tabs[sourceIndex];
  if (!sourceTab || !isAppShellTabCloseModeClosableRunTab(sourceTab)) return null;

  const measuredWidthByTabId = new Map<string, number>();
  for (const measuredTab of measuredTabs) {
    const width = normalizeAppShellTabCloseModeWidth(measuredTab.width);
    if (width === null) continue;
    measuredWidthByTabId.set(measuredTab.id, width);
  }

  const sourceWidthPx = measuredWidthByTabId.get(sourceTabId);
  if (sourceWidthPx === undefined) return null;

  const runTabIds: string[] = [];
  for (const candidate of tabs.slice(sourceIndex + 1)) {
    if (!isAppShellTabCloseModeClosableRunTab(candidate)) break;
    if (!measuredWidthByTabId.has(candidate.id)) break;
    runTabIds.push(candidate.id);
  }
  if (runTabIds.length === 0) return null;

  const runTabIdSet = new Set(runTabIds);
  const widthByTabId: Record<string, number> = {};
  for (const tab of tabs) {
    const measuredWidth = measuredWidthByTabId.get(tab.id);
    if (measuredWidth === undefined) continue;
    widthByTabId[tab.id] = runTabIdSet.has(tab.id) ? sourceWidthPx : measuredWidth;
  }

  return {
    sourceTabId,
    sourceWidthPx,
    widthByTabId,
    runTabIds,
    scrollLeft: rowScrollLeft,
    hotZone: expandAppShellTabCloseModeHotZone(rowRect, hotZoneSlop),
    tabIdsSignature,
  };
}

export function expandAppShellTabCloseModeHotZone(
  rowRect: AppShellTabCloseModeRect,
  slop: AppShellTabCloseModeSlop = APP_SHELL_TAB_CLOSE_MODE_HOT_ZONE_SLOP,
): AppShellTabCloseModeRect {
  return {
    left: rowRect.left - slop.left,
    right: rowRect.right + slop.right,
    top: rowRect.top - slop.top,
    bottom: rowRect.bottom + slop.bottom,
  };
}

export function isPointInsideAppShellTabCloseModeHotZone({
  clientX,
  clientY,
  hotZone,
}: {
  clientX: number;
  clientY: number;
  hotZone: AppShellTabCloseModeRect;
}): boolean {
  if (clientX < hotZone.left) return false;
  if (clientX > hotZone.right) return false;
  if (clientY < hotZone.top) return false;
  if (clientY > hotZone.bottom) return false;
  return true;
}

function isAppShellTabCloseModeClosableRunTab(tab: AppShellTabCloseModeTab): boolean {
  if (tab.isLabel === true) return false;
  return tab.closable === true;
}

function normalizeAppShellTabCloseModeWidth(width: number): number | null {
  if (!Number.isFinite(width)) return null;
  if (width <= 0) return null;
  return Math.round(width);
}
