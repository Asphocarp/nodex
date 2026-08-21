import { describe, expect, test } from "vite-plus/test";
import { probeBrowserNativeCapabilities } from "./browser-native-capabilities";

describe("probeBrowserNativeCapabilities", () => {
  test("reports public Electron and product-owned provider capabilities", () => {
    const capabilities = probeBrowserNativeCapabilities({
      credentialVaultProviderAvailable: true,
      downloadStoreAvailable: true,
      electronSession: {
        cookies: {
          get: () => undefined,
          set: () => undefined,
        },
        extensions: {},
      },
      safeStorageEncryptionAvailable: true,
      profileImportProviderAvailable: true,
      siteInfoProviderAvailable: true,
      webContents: {
        navigationHistory: {
          getAllEntries: () => [],
          getActiveIndex: () => 0,
          restore: async () => undefined,
        },
      },
    });

    expect(capabilities.navigationHistoryRestore.available).toBe(true);
    expect(capabilities.profileCookiesImport.provider).toBe("nodex-profile-import");
    expect(capabilities.passwordAutofill.provider).toBe("nodex-encrypted-vault");
    expect(capabilities.nativeDownloadHistory.provider).toBe("nodex-download-store");
    expect(capabilities.extensions.available).toBe(true);
  });

  test("keeps private Electron gaps explicit instead of claiming parity", () => {
    const capabilities = probeBrowserNativeCapabilities({
      safeStorageEncryptionAvailable: false,
    });
    expect(capabilities.guestDestroy.available).toBe(false);
    expect(capabilities.livePopupTransfer.available).toBe(false);
    expect(capabilities.profilePasswordsImport.available).toBe(false);
    expect(capabilities.navigationHistoryRestore.available).toBe(false);
  });
});
