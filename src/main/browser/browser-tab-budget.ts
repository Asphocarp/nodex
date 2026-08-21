import type {
  BrowserPageLifecycleState,
  BrowserSidebarTabIdentity,
} from "../../shared/browser-sidebar";

export const MAX_LIVE_DETACHED_BROWSER_PAGES_PER_WINDOW = 32;
export const RECENTLY_SELECTED_BROWSER_PAGE_PROTECTION_MS = 30 * 60_000;

export interface BrowserTabBudgetEntry extends BrowserSidebarTabIdentity {
  activeDownload: boolean;
  audible: boolean;
  browserUseActive: boolean;
  captureActive: boolean;
  isLoading: boolean;
  lastSelectedAt: number;
  lifecycleState: BrowserPageLifecycleState;
  mediaActive: boolean;
  presented: boolean;
  updatedAt: number;
}

export interface BrowserTabBudgetOptions {
  maxLiveDetachedPages?: number;
  now?: number;
  recentProtectionMs?: number;
}

function isLiveDetached(entry: BrowserTabBudgetEntry): boolean {
  return entry.lifecycleState === "live-detached";
}

function isProtected(
  entry: BrowserTabBudgetEntry,
  now: number,
  recentProtectionMs: number,
): boolean {
  if (entry.presented) return true;
  if (entry.browserUseActive || entry.captureActive) return true;
  if (entry.audible || entry.mediaActive || entry.activeDownload) return true;
  if (entry.isLoading || entry.lifecycleState === "restoring") return true;
  return now - entry.lastSelectedAt <= recentProtectionMs;
}

export function selectBrowserTabsToSuspend(
  entries: readonly BrowserTabBudgetEntry[],
  options: BrowserTabBudgetOptions = {},
): BrowserTabBudgetEntry[] {
  const maxLiveDetachedPages =
    options.maxLiveDetachedPages ?? MAX_LIVE_DETACHED_BROWSER_PAGES_PER_WINDOW;
  const recentProtectionMs =
    options.recentProtectionMs ?? RECENTLY_SELECTED_BROWSER_PAGE_PROTECTION_MS;
  const now = options.now ?? Date.now();
  const liveDetached = entries.filter(isLiveDetached);
  const overflow = liveDetached.length - maxLiveDetachedPages;
  if (overflow <= 0) return [];

  return liveDetached
    .filter((entry) => !isProtected(entry, now, recentProtectionMs))
    .sort(
      (left, right) =>
        left.lastSelectedAt - right.lastSelectedAt ||
        left.updatedAt - right.updatedAt ||
        left.browserTabId.localeCompare(right.browserTabId),
    )
    .slice(0, overflow);
}
