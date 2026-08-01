import { describe, expect, test } from "vitest";

import { macosSigningSecurityCommands } from "./macos-signing-keychain";

describe("macOS signing keychain", () => {
  test("keeps the PKCS#12 and temporary keychain passwords in their distinct security commands", () => {
    const commands = macosSigningSecurityCommands({
      certificatePassword: "certificate-password",
      keychainPassword: "keychain-password",
      paths: {
        apiKey: "/tmp/AuthKey.p8",
        certificate: "/tmp/certificate.p12",
        keychain: "/tmp/signing.keychain-db",
      },
    });

    expect(commands).toContainEqual([
      "import",
      "/tmp/certificate.p12",
      "-P",
      "certificate-password",
      "-t",
      "cert",
      "-f",
      "pkcs12",
      "-k",
      "/tmp/signing.keychain-db",
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/productbuild",
    ]);
    expect(commands).toContainEqual([
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      "keychain-password",
      "/tmp/signing.keychain-db",
    ]);
  });
});
