import path from "node:path";
import { safeStorage } from "electron";
import { getNodexHome } from "../local-store/config";
import { ProviderCredentialStore } from "./provider-credential-store";

export function createElectronProviderCredentialStore(): ProviderCredentialStore {
  return new ProviderCredentialStore({
    filePath: path.join(getNodexHome(), "secrets", "provider-credentials.v1.json"),
    encryption: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plaintext) => safeStorage.encryptString(plaintext),
      decryptString: (ciphertext) => safeStorage.decryptString(ciphertext),
    },
  });
}
