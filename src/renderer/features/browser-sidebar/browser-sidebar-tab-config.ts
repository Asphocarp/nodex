interface BrowserTabConfigCarrier {
  config: unknown;
}

function readBrowserConfig(tab: BrowserTabConfigCarrier): Record<string, unknown> {
  if (typeof tab.config !== "object" || tab.config === null || Array.isArray(tab.config)) return {};
  return tab.config as Record<string, unknown>;
}

export function readBrowserConfigUrl(tab: BrowserTabConfigCarrier): string {
  const config = readBrowserConfig(tab);
  return typeof config.url === "string" ? config.url : "about:blank";
}

export function readBrowserConfigTitle(tab: BrowserTabConfigCarrier): string | undefined {
  const config = readBrowserConfig(tab);
  return typeof config.title === "string" ? config.title : undefined;
}

export function readBrowserConfigFavicon(tab: BrowserTabConfigCarrier): string | undefined {
  const config = readBrowserConfig(tab);
  return typeof config.faviconUrl === "string" ? config.faviconUrl : undefined;
}

export function readBrowserConfigDeviceToolbarVisible(tab: BrowserTabConfigCarrier): boolean {
  const config = readBrowserConfig(tab);
  return config.deviceToolbarVisible === true;
}
