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

const manifestRelativePath = "Contents/Resources/bin/rust-core-runtime.json";
const expectedBinaryPaths = new Map([
  ["nodex", "Resources/bin/nodex"],
  ["nodex-core", "Resources/bin/nodex-core"],
  ["nodex-service", "Helpers/Nodex Service.app/Contents/MacOS/nodex-service"],
]);

const sha256File = (filePath) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const refreshSignedRuntimeManifest = (appPath) => {
  const manifestPath = path.join(appPath, manifestRelativePath);
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

  const temporaryPath = `${manifestPath}.signed-runtime.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ ...manifest, binaries }, null, 2)}\n`, {
    mode: 0o644,
  });
  renameSync(temporaryPath, manifestPath);
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

  refreshSignedRuntimeManifest(options.app);

  await signWithRetry({
    ...options,
    binaries: [],
    ignore: (filePath) => filePath !== options.app,
  });
};
