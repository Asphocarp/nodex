import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { signAsync } from "@electron/osx-sign";
import { writePackagedBuildProvenance } from "./package-provenance.mjs";

const nativeManifestRelativePath = "Contents/Resources/bin/rust-core-runtime.json";
const agentManifestRelativePath = "Contents/Resources/agent-runtime.json";
const browserManifestRelativePath =
  "Contents/Resources/browser-runtime/browser-runtime-manifest.json";
const browserRuntimeSchemaVersion = 3;
const expectedBinaryPaths = new Map([
  ["nodex", "Resources/bin/nodex"],
  ["nodex-appshot-helper", "Resources/bin/nodex-appshot-helper"],
  ["nodex-browser-profile-helper", "Resources/bin/nodex-browser-profile-helper"],
  ["nodex-core", "Resources/bin/nodex-core"],
  ["nodex-service", "Helpers/Nodex Service.app/Contents/MacOS/nodex-service"],
]);

const sha256File = (filePath) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const writeManifestAtomically = (manifestPath, manifest) => {
  const temporaryPath = `${manifestPath}.signed-runtime.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o644,
  });
  renameSync(temporaryPath, manifestPath);
};

const refreshSignedNativeRuntimeManifest = (appPath) => {
  const manifestPath = path.join(appPath, nativeManifestRelativePath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (manifest.schemaVersion !== 3 || !Array.isArray(manifest.binaries)) {
    throw new Error(`Unsupported native runtime manifest: ${manifestPath}`);
  }
  if (manifest.binaries.length !== expectedBinaryPaths.size) {
    throw new Error(`Native runtime manifest is not closed: ${manifestPath}`);
  }

  const seenNames = new Set();
  const binaries = manifest.binaries.map((entry) => {
    const expectedPath = expectedBinaryPaths.get(entry.name);
    if (!expectedPath || entry.bundlePath !== expectedPath || seenNames.has(entry.name)) {
      throw new Error(`Unexpected native runtime entry: ${JSON.stringify(entry)}`);
    }
    seenNames.add(entry.name);

    const binaryPath = path.join(appPath, "Contents", expectedPath);
    const metadata = lstatSync(binaryPath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o111) === 0) {
      throw new Error(`Native runtime entry is not a regular executable: ${binaryPath}`);
    }

    return {
      ...entry,
      sourceSha256: sha256File(binaryPath),
      sourceSize: statSync(binaryPath).size,
    };
  });

  if (seenNames.size !== expectedBinaryPaths.size) {
    throw new Error(`Native runtime manifest is missing an expected binary: ${manifestPath}`);
  }

  writeManifestAtomically(manifestPath, { ...manifest, binaries });
};

const requireSafeAgentArtifactPath = (artifactPath, manifestPath) => {
  if (
    typeof artifactPath !== "string"
    || artifactPath.length === 0
    || artifactPath.startsWith("/")
    || artifactPath.includes("\\")
    || artifactPath.split("/").some((segment) => (
      segment.length === 0 || segment === "." || segment === ".."
    ))
  ) {
    throw new Error(`Invalid Agent runtime artifact path in ${manifestPath}`);
  }
  return artifactPath;
};

const readMacosTeamIdentifier = (artifactPath) => {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", artifactPath], {
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`Could not inspect Browser runtime signature: ${result.error.message}`);
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`Could not inspect Browser runtime signature: ${output.trim()}`);
  }
  const teamIdentifier = /^TeamIdentifier=(.+)$/mu.exec(output)?.[1]?.trim();
  if (!teamIdentifier || teamIdentifier === "not set") {
    throw new Error("Browser runtime peer authorization has no Developer ID team");
  }
  return teamIdentifier;
};

export const refreshSignedAgentRuntimeMetadata = (appPath) => {
  const manifestPath = path.join(appPath, agentManifestRelativePath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.layoutVersion !== 2 || !Array.isArray(manifest.artifacts)) {
    throw new Error(`Unsupported Agent runtime manifest: ${manifestPath}`);
  }

  const seenPaths = new Set();
  const artifacts = manifest.artifacts.map((entry) => {
    const artifactPath = requireSafeAgentArtifactPath(entry.path, manifestPath);
    if (seenPaths.has(artifactPath) || typeof entry.executable !== "boolean") {
      throw new Error(`Invalid Agent runtime artifact entry in ${manifestPath}`);
    }
    seenPaths.add(artifactPath);

    const bundledPath = path.join(
      appPath,
      "Contents",
      "Resources",
      ...artifactPath.split("/"),
    );
    const metadata = lstatSync(bundledPath);
    const executable = (metadata.mode & 0o111) !== 0;
    if (metadata.isSymbolicLink() || !metadata.isFile() || executable !== entry.executable) {
      throw new Error(`Agent runtime entry is not a regular artifact: ${bundledPath}`);
    }
    return {
      ...entry,
      sha256: sha256File(bundledPath),
      size: metadata.size,
    };
  });

  writeManifestAtomically(manifestPath, { ...manifest, artifacts });
};

export const refreshSignedBrowserRuntimeManifest = (
  appPath,
  options = {},
) => {
  const manifestPath = path.join(appPath, browserManifestRelativePath);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
  if (
    manifest.schemaVersion !== browserRuntimeSchemaVersion
    || manifest.contractVersion !== 1
    || !Array.isArray(manifest.artifacts)
  ) {
    throw new Error(`Unsupported Browser runtime manifest: ${manifestPath}`);
  }

  const seenPaths = new Set();
  const artifacts = manifest.artifacts.map((entry) => {
    const artifactPath = requireSafeAgentArtifactPath(entry.path, manifestPath);
    if (
      seenPaths.has(artifactPath)
      || typeof entry.executable !== "boolean"
      || !["data", "executable", "native-addon"].includes(entry.kind)
    ) {
      throw new Error(`Invalid Browser runtime artifact entry in ${manifestPath}`);
    }
    seenPaths.add(artifactPath);

    const bundledPath = path.join(
      appPath,
      "Contents",
      "Resources",
      "browser-runtime",
      ...artifactPath.split("/"),
    );
    const metadata = lstatSync(bundledPath);
    const executable = (metadata.mode & 0o111) !== 0;
    if (metadata.isSymbolicLink() || !metadata.isFile() || executable !== entry.executable) {
      throw new Error(`Browser runtime entry is not a regular artifact: ${bundledPath}`);
    }
    return {
      ...entry,
      sha256: sha256File(bundledPath),
      size: metadata.size,
    };
  });

  const peerAuthorizationPath = requireSafeAgentArtifactPath(
    manifest.entrypoints?.peerAuthorization,
    manifestPath,
  );
  const peerAuthorization = artifacts.find(
    (artifact) => artifact.path === peerAuthorizationPath,
  );
  if (
    !peerAuthorization
    || peerAuthorization.kind !== "native-addon"
    || !manifest.peerAuthorization
  ) {
    throw new Error(`Browser runtime peer authorization is invalid: ${manifestPath}`);
  }
  const bundledPeerAuthorizationPath = path.join(
    appPath,
    "Contents",
    "Resources",
    "browser-runtime",
    ...peerAuthorizationPath.split("/"),
  );
  const signingTeamId = (
    options.readSigningTeamIdentifier ?? readMacosTeamIdentifier
  )(bundledPeerAuthorizationPath);

  writeManifestAtomically(manifestPath, {
    ...manifest,
    artifacts,
    peerAuthorization: {
      ...manifest.peerAuthorization,
      signingTeamId,
    },
  });
  return true;
};

const signWithRetry = async (options) => {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await signAsync(options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
    }
  }
  throw lastError;
};

/**
 * `NODEX_MAC_SIGN_MODE=local` keeps the resolved Developer ID identity — so
 * Keychain ACLs, TCC grants, and launchd registrations stay stable across
 * reinstalls — but disables the Apple timestamp service. One TSA network round
 * trip per Mach-O is what turns a full deep sign into minutes, and local test
 * installs are never notarized, so secure timestamps buy nothing there.
 */
export const applyMacSigningMode = (
  options,
  mode = process.env.NODEX_MAC_SIGN_MODE,
) => {
  if (!mode) return options;
  if (mode !== "local") {
    throw new Error(`Unknown NODEX_MAC_SIGN_MODE: ${mode}`);
  }
  const baseOptionsForFile = options.optionsForFile;
  return {
    ...options,
    optionsForFile: (filePath) => ({
      ...(baseOptionsForFile ? baseOptionsForFile(filePath) : {}),
      timestamp: "none",
    }),
  };
};

export const sign = async (options) => {
  const signOptions = applyMacSigningMode(options);
  await signWithRetry(signOptions);
  if (signOptions.platform !== "darwin") return;

  refreshSignedNativeRuntimeManifest(signOptions.app);
  refreshSignedAgentRuntimeMetadata(signOptions.app);
  refreshSignedBrowserRuntimeManifest(signOptions.app);
  writePackagedBuildProvenance(signOptions.app);

  await signWithRetry({
    ...signOptions,
    binaries: [],
    ignore: (filePath) => filePath !== signOptions.app,
  });
};
