import type { BrowserExtensionsProvider } from "./browser-extensions-provider";
import type { BrowserSiteInfoProvider } from "./browser-site-info-provider";

export interface BrowserProfileServices {
  extensionsProvider: BrowserExtensionsProvider;
  siteInfoProvider: BrowserSiteInfoProvider;
}
