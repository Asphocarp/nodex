import type { BrowserCredentialService } from "./browser-credential-service";
import type { BrowserExtensionsProvider } from "./browser-extensions-provider";
import type { BrowserProfileImporter } from "./browser-profile-importer";
import type { BrowserSiteInfoProvider } from "./browser-site-info-provider";
import type { BrowserLocalServerPreferencesStore } from "./browser-local-server-preferences";

export interface BrowserProfileServices {
  credentialService: BrowserCredentialService;
  extensionsProvider: BrowserExtensionsProvider;
  localServerPreferencesStore: BrowserLocalServerPreferencesStore;
  profileImporter: BrowserProfileImporter;
  siteInfoProvider: BrowserSiteInfoProvider;
}
