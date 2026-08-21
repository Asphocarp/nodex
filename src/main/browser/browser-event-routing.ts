import {
  makeBrowserSidebarConversationScopeKey,
  type BrowserSidebarBrowserUseStateSnapshot,
  type BrowserSidebarStateSnapshot,
} from "../../shared/browser-sidebar";

export function filterBrowserStateForViewScope(
  snapshot: BrowserSidebarStateSnapshot,
  browserViewScopeId: string,
): BrowserSidebarStateSnapshot {
  return {
    tabs: snapshot.tabs.filter((tab) => tab.browserViewScopeId === browserViewScopeId),
  };
}

export function filterBrowserUseStateForViewScope(
  snapshot: BrowserSidebarBrowserUseStateSnapshot,
  browserViewScopeId: string,
): BrowserSidebarBrowserUseStateSnapshot {
  const tabs = snapshot.tabs.filter((tab) => tab.browserViewScopeId === browserViewScopeId);
  const cursors = snapshot.cursors.filter(
    (cursor) => cursor.browserViewScopeId === browserViewScopeId,
  );
  const activeScopeKeys = new Set(tabs.map((tab) => makeBrowserSidebarConversationScopeKey(tab)));
  return {
    tabs,
    cursors,
    activeBrowserTabIdsByConversationScope: Object.fromEntries(
      Object.entries(snapshot.activeBrowserTabIdsByConversationScope).filter(([scopeKey]) =>
        activeScopeKeys.has(scopeKey),
      ),
    ),
  };
}
