import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { signAsync } from "@electron/osx-sign";

const nativeManifestRelativePath = "Contents/Resources/bin/rust-core-runtime.json";
const agentManifestRelativePath = "Contents/Resources/agent-runtime.json";
const expectedBinaryPaths = new Map([
  ["nodex", "Resources/bin/nodex"],
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

  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.binaries)) {
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

export const sign = async (options) => {
  await signWithRetry(options);
  if (options.platform !== "darwin") return;

  refreshSignedNativeRuntimeManifest(options.app);
  refreshSignedAgentRuntimeMetadata(options.app);

  await signWithRetry({
    ...options,
    binaries: [],
    ignore: (filePath) => filePath !== options.app,
  });
};
