import { useEffect } from "react";
import { invoke } from "@/lib/api";
import { useTheme } from "@/lib/use-theme";

export function BrowserSidebarThemeSynchronizer() {
  const { resolved } = useTheme();

  useEffect(() => {
    if (!window.api || window.__NODEX_STORYBOOK__) return;
    void invoke("browser-sidebar-command", {
      type: "sync-theme",
      themeVariant: resolved,
    });
  }, [resolved]);

  return null;
}
