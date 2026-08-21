import { useEffect } from "react";
import { startBrowserSidebarRendererStateStore } from "./browser-sidebar-renderer-state-store";

export function BrowserSidebarRuntimeSynchronizer() {
  useEffect(() => startBrowserSidebarRendererStateStore(), []);
  return null;
}
