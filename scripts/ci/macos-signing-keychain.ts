import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface MacosSigningPaths {
  readonly apiKey: string;
  readonly certificate: string;
  readonly keychain: string;
}

interface MacosSigningSecurityOptions {
  readonly certificatePassword: string;
  readonly keychainPassword: string;
  readonly paths: MacosSigningPaths;
}

interface MacosSigningSecurityDependencies {
  readonly maskValue: (value: string) => void;
  readonly runCommand: (command: readonly string[]) => void;
}

const scriptPath = fileURLToPath(import.meta.url);

export const macosSigningSecurityCommands = (
  options: MacosSigningSecurityOptions,
): readonly (readonly string[])[] => [
  ["create-keychain", "-p", options.keychainPassword, options.paths.keychain],
  ["set-keychain-settings", "-lut", "21600", options.paths.keychain],
  ["unlock-keychain", "-p", options.keychainPassword, options.paths.keychain],
  [
    "import",
    options.paths.certificate,
    "-P",
    options.certificatePassword,
    "-t",
    "cert",
    "-f",
    "pkcs12",
    "-k",
    options.paths.keychain,
    "-T",
    "/usr/bin/codesign",
    "-T",
    "/usr/bin/productbuild",
  ],
  [
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:",
    "-s",
    "-k",
    options.keychainPassword,
    options.paths.keychain,
  ],
  ["list-keychains", "-d", "user", "-s", options.paths.keychain],
];

export const githubActionsMaskCommand = (value: string): string => {
  if (!value) throw new Error("Cannot mask an empty GitHub Actions value.");
  const escaped = value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  return `::add-mask::${escaped}\n`;
};

export const configureMacosSigningKeychain = (
  options: MacosSigningSecurityOptions,
  dependencies: MacosSigningSecurityDependencies,
): void => {
  dependencies.maskValue(options.keychainPassword);
  for (const command of macosSigningSecurityCommands(options)) {
    try {
      dependencies.runCommand(command);
    } catch {
      throw new Error(
        `Failed to configure the macOS signing keychain during security ${command[0]}.`,
      );
    }
  }
};

const requiredEnvironmentValue = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value) return value;
  throw new Error(`Missing required macOS signing environment variable: ${name}`);
};

const decodeBase64Secret = (value: string, label: string): Buffer => {
  const payload = value.startsWith("data:")
    ? value.slice(value.indexOf(",") + 1)
    : value;
  const normalized = payload.replaceAll(/\s/gu, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)) {
    throw new Error(`${label} must be a base64 payload or base64 data URL.`);
  }
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length > 0) return decoded;
  throw new Error(`${label} decoded to an empty file.`);
};

const pathsFor = (runnerTemp: string, apiKeyId: string): MacosSigningPaths => {
  if (!/^[A-Za-z0-9]+$/u.test(apiKeyId)) {
    throw new Error("APPLE_API_KEY_ID must be alphanumeric.");
  }
  return {
    apiKey: path.join(runnerTemp, `AuthKey_${apiKeyId}.p8`),
    certificate: path.join(runnerTemp, "nodex-developer-id.p12"),
    keychain: path.join(runnerTemp, "nodex-signing.keychain-db"),
  };
};

const deleteKeychain = (keychainPath: string): void => {
  if (process.platform === "darwin") {
    spawnSync("/usr/bin/security", ["delete-keychain", keychainPath], {
      stdio: "ignore",
    });
  }
  rmSync(keychainPath, { force: true });
};

const cleanupPaths = (paths: MacosSigningPaths): void => {
  deleteKeychain(paths.keychain);
  rmSync(paths.apiKey, { force: true });
  rmSync(paths.certificate, { force: true });
};

const appendJobEnvironment = (
  environmentFile: string,
  entries: Readonly<Record<string, string>>,
): void => {
  const lines = Object.entries(entries).map(([name, value]) => {
    if (value.includes("\n") || value.includes("\r")) {
      throw new Error(`GitHub Actions environment value ${name} contains a newline.`);
    }
    return `${name}=${value}`;
  });
  appendFileSync(environmentFile, `${lines.join("\n")}\n`, "utf8");
};

const prepare = (): void => {
  if (process.platform !== "darwin") {
    throw new Error("macOS signing credentials can only be prepared on macOS.");
  }
  const runnerTemp = requiredEnvironmentValue("RUNNER_TEMP");
  const environmentFile = requiredEnvironmentValue("GITHUB_ENV");
  const apiKeyId = requiredEnvironmentValue("APPLE_API_KEY_ID");
  const paths = pathsFor(runnerTemp, apiKeyId);
  const certificatePassword = requiredEnvironmentValue("CSC_KEY_PASSWORD");
  const keychainPassword = randomBytes(32).toString("hex");

  cleanupPaths(paths);
  try {
    writeFileSync(
      paths.apiKey,
      decodeBase64Secret(requiredEnvironmentValue("APPLE_API_KEY_B64"), "APPLE_API_KEY_B64"),
      { mode: 0o600 },
    );
    writeFileSync(
      paths.certificate,
      decodeBase64Secret(requiredEnvironmentValue("CSC_LINK"), "CSC_LINK"),
      { mode: 0o600 },
    );
    chmodSync(paths.apiKey, 0o600);
    chmodSync(paths.certificate, 0o600);

    configureMacosSigningKeychain(
      { certificatePassword, keychainPassword, paths },
      {
        maskValue: (value) => process.stdout.write(githubActionsMaskCommand(value)),
        runCommand: (command) =>
          execFileSync("/usr/bin/security", [...command], { stdio: "inherit" }),
      },
    );

    appendJobEnvironment(environmentFile, {
      APPLE_API_KEY: paths.apiKey,
      CSC_IDENTITY_AUTO_DISCOVERY: "true",
      NODEX_SIGNING_CERTIFICATE: paths.certificate,
      NODEX_SIGNING_KEYCHAIN: paths.keychain,
    });
  } catch (error) {
    cleanupPaths(paths);
    throw error;
  }
};

const main = (): void => {
  const [command, ...extraArguments] = process.argv.slice(2);
  if (extraArguments.length > 0 || command !== "prepare") {
    throw new Error("Usage: macos-signing-keychain.ts prepare");
  }
  prepare();
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
