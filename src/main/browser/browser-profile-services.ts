import type { BrowserCredentialService } from "./browser-credential-service";
import type { BrowserExtensionsProvider } from "./browser-extensions-provider";
import type { BrowserProfileImporter } from "./browser-profile-importer";
import type { BrowserSiteInfoProvider } from "./browser-site-info-provider";
import type { BrowserUsePolicyStore } from "../browser-use/browser-use-policy-store";
import type { BrowserLocalServerPreferencesStore } from "./browser-local-server-preferences";

export interface BrowserProfileServices {
  credentialService: BrowserCredentialService;
  extensionsProvider: BrowserExtensionsProvider;
  localServerPreferencesStore: BrowserLocalServerPreferencesStore;
  profileImporter: BrowserProfileImporter;
  siteInfoProvider: BrowserSiteInfoProvider;
  usePolicyStore: BrowserUsePolicyStore;
}

let services: BrowserProfileServices | null = null;

export function configureBrowserProfileServices(nextServices: BrowserProfileServices): void {
  services = nextServices;
}

export function getBrowserProfileServices(): BrowserProfileServices {
  if (!services) {
    throw new Error("Browser Profile services are not configured");
  }
  return services;
}
