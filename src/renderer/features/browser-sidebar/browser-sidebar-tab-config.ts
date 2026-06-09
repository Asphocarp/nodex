import type { ProjectSessionTab } from "@/lib/types";

export function readBrowserConfigUrl(tab: ProjectSessionTab): string {
  if (!("url" in tab.config) || typeof tab.config.url !== "string") return "about:blank";
  return tab.config.url;
}

export function readBrowserConfigTitle(tab: ProjectSessionTab): string | undefined {
  if (!("title" in tab.config) || typeof tab.config.title !== "string") return undefined;
  return tab.config.title;
}

export function readBrowserConfigFavicon(tab: ProjectSessionTab): string | undefined {
  if (!("faviconUrl" in tab.config) || typeof tab.config.faviconUrl !== "string") return undefined;
  return tab.config.faviconUrl;
}

export function readBrowserConfigDeviceToolbarVisible(tab: ProjectSessionTab): boolean {
  return "deviceToolbarVisible" in tab.config && tab.config.deviceToolbarVisible === true;
}
