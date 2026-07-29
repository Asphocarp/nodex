export type BrowserNativeCapabilityProvider =
  | "electron-public-api"
  | "nodex-download-store"
  | "nodex-encrypted-vault"
  | "nodex-profile-import"
  | "unavailable";

export interface BrowserNativeCapability {
  available: boolean;
  provider: BrowserNativeCapabilityProvider;
  reason?: string;
}

export interface BrowserNativeCapabilities {
  navigationHistoryRestore: BrowserNativeCapability;
  guestDestroy: BrowserNativeCapability;
  livePopupTransfer: BrowserNativeCapability;
  profileCookiesImport: BrowserNativeCapability;
  profilePasswordsImport: BrowserNativeCapability;
  passwordAutofill: BrowserNativeCapability;
  nativeDownloadHistory: BrowserNativeCapability;
  siteInfo: BrowserNativeCapability;
  extensions: BrowserNativeCapability;
  encryptedCredentialStorage: BrowserNativeCapability;
}

export interface BrowserNativeCapabilityProbe {
  credentialVaultProviderAvailable?: boolean;
  downloadStoreAvailable?: boolean;
  electronSession?: {
    cookies?: { get: unknown; set: unknown };
    extensions?: unknown;
  };
  safeStorageEncryptionAvailable: boolean;
  profileImportProviderAvailable?: boolean;
  siteInfoProviderAvailable?: boolean;
  webContents?: {
    navigationHistory?: {
      getAllEntries?: unknown;
      getActiveIndex?: unknown;
      restore?: unknown;
    };
  };
}

function available(
  provider: BrowserNativeCapabilityProvider,
): BrowserNativeCapability {
  return { available: true, provider };
}

function unavailable(reason: string): BrowserNativeCapability {
  return { available: false, provider: "unavailable", reason };
}

function hasFunction(value: unknown): boolean {
  return typeof value === "function";
}

export function probeBrowserNativeCapabilities(
  probe: BrowserNativeCapabilityProbe,
): BrowserNativeCapabilities {
  const history = probe.webContents?.navigationHistory;
  const navigationHistoryRestore =
    hasFunction(history?.getAllEntries)
    && hasFunction(history?.getActiveIndex)
    && hasFunction(history?.restore)
      ? available("electron-public-api")
      : unavailable("Electron navigationHistory.restore is unavailable");
  const cookies = probe.electronSession?.cookies;
  const profileCookiesImport =
    hasFunction(cookies?.get) && hasFunction(cookies?.set)
      ? available("nodex-profile-import")
      : unavailable("Electron cookie import APIs are unavailable");

  return {
    navigationHistoryRestore,
    guestDestroy: unavailable(
      "Stock Electron does not expose webview.destroy(); Nodex uses generation-safe DOM teardown",
    ),
    livePopupTransfer: unavailable(
      "Stock Electron cannot adopt a live popup WebContents without reload",
    ),
    profileCookiesImport: profileCookiesImport.available
      && probe.profileImportProviderAvailable === true
      ? profileCookiesImport
      : unavailable("Profile import provider is unavailable"),
    profilePasswordsImport:
      probe.safeStorageEncryptionAvailable
      && probe.profileImportProviderAvailable === true
      ? available("nodex-profile-import")
      : unavailable("Encrypted credential storage is unavailable"),
    passwordAutofill:
      probe.safeStorageEncryptionAvailable
      && probe.credentialVaultProviderAvailable === true
      ? available("nodex-encrypted-vault")
      : unavailable("Encrypted credential storage is unavailable"),
    nativeDownloadHistory: probe.downloadStoreAvailable === true
      ? available("nodex-download-store")
      : unavailable("Nodex download history store is unavailable"),
    siteInfo: probe.siteInfoProviderAvailable === true
      ? available("electron-public-api")
      : unavailable("Site information provider is unavailable"),
    extensions: probe.electronSession?.extensions
      ? available("electron-public-api")
      : unavailable("Electron session extensions API is unavailable"),
    encryptedCredentialStorage: probe.safeStorageEncryptionAvailable
      ? available("nodex-encrypted-vault")
      : unavailable("safeStorage encryption is unavailable"),
  };
}
