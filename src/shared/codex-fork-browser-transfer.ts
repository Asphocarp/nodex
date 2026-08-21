import type { BrowserSidebarDeviceToolbarState } from "./browser-sidebar";
import type { WorkbenchPanelId } from "./workbench-session-view";
import type { WorkbenchSceneSnapshot } from "./workbench-scene";

export interface CodexForkBrowserSceneContext {
  browserViewScopeId: string;
  scene: WorkbenchSceneSnapshot;
}

export interface CodexForkBrowserTabDescriptor {
  active: boolean;
  browserTabId: string;
  deviceToolbarState: BrowserSidebarDeviceToolbarState;
  initialUrl: string | null;
  kind: "browser";
  panel: WorkbenchPanelId;
  tabId: string;
}

export interface CodexForkBrowserSidePanelSnapshot {
  bottomPanelOpen: boolean;
  focusArea: "main" | "right-panel" | "bottom-panel";
  rightPanelFullWidth: boolean;
  rightPanelOpen: boolean;
  sourceBrowserConversationId: string;
  sourceBrowserViewScopeId: string;
  tabs: CodexForkBrowserTabDescriptor[];
  targetBrowserConversationId: string;
  targetBrowserViewScopeId: string;
}

export interface CodexForkBrowserTransferConsumeInput {
  routeKind: "local-thread";
  targetConversationId: string;
  targetProjectSessionId: string;
  targetBrowserViewScopeId: string;
}
