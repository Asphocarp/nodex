import type { BrowserExtensionsProvider } from "./browser-extensions-provider";
import type { BrowserProfileImporter } from "./browser-profile-importer";
import type { BrowserSiteInfoProvider } from "./browser-site-info-provider";

export interface BrowserProfileServices {
  extensionsProvider: BrowserExtensionsProvider;
  profileImporter: BrowserProfileImporter;
  siteInfoProvider: BrowserSiteInfoProvider;
}
