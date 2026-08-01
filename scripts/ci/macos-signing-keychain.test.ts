import { describe, expect, test } from "vitest";

import {
  configureMacosSigningKeychain,
  githubActionsMaskCommand,
  macosSigningSecurityCommands,
} from "./macos-signing-keychain";

const options = {
  certificatePassword: "certificate-password",
  keychainPassword: "keychain-password",
  paths: {
    apiKey: "/tmp/AuthKey.p8",
    certificate: "/tmp/certificate.p12",
    keychain: "/tmp/signing.keychain-db",
  },
} as const;

describe("macOS signing keychain", () => {
  test("keeps the PKCS#12 and temporary keychain passwords in their distinct security commands", () => {
    const commands = macosSigningSecurityCommands(options);

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

  test("masks the generated keychain password before invoking security", () => {
    const events: string[] = [];

    configureMacosSigningKeychain(options, {
      maskValue: (value) => events.push(`mask:${value}`),
      runCommand: (command) => events.push(`security:${command[0]}`),
    });

    expect(events[0]).toBe("mask:keychain-password");
    expect(events.slice(1)).toEqual([
      "security:create-keychain",
      "security:set-keychain-settings",
      "security:unlock-keychain",
      "security:import",
      "security:set-key-partition-list",
      "security:list-keychains",
    ]);
  });

  test("redacts security arguments from command failures", () => {
    expect(() =>
      configureMacosSigningKeychain(options, {
        maskValue: () => undefined,
        runCommand: (command) => {
          if (command[0] === "unlock-keychain") throw new Error(command.join(" "));
        },
      }),
    ).toThrowError(
      "Failed to configure the macOS signing keychain during security unlock-keychain.",
    );
  });

  test("escapes GitHub workflow-command delimiters when registering a mask", () => {
    expect(githubActionsMaskCommand("secret%value\r\nnext")).toBe(
      "::add-mask::secret%25value%0D%0Anext\n",
    );
  });
});
