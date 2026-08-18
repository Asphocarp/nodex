import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { inspectOfficialAgentSkillsArtifact } from "./official-agent-skills-artifact.mjs";
import { isBrowserRuntimeCompatibleWithCodex } from "../src/shared/browser-runtime-codex-compatibility.mjs";

const PROVENANCE_SCHEMA_VERSION = 4;
const PREPARED_SCHEMA_VERSION = 3;
const resourcesRelativePath = "Contents/Resources";
const provenanceRelativePath = `${resourcesRelativePath}/nodex-build-provenance.json`;
const preparedRelativePath = `${resourcesRelativePath}/prepared-electron-build.json`;
const appAsarRelativePath = `${resourcesRelativePath}/app.asar`;
const nativeManifestRelativePath = `${resourcesRelativePath}/bin/rust-core-runtime.json`;
const agentManifestRelativePath = `${resourcesRelativePath}/agent-runtime.json`;
const browserManifestRelativePath =
  `${resourcesRelativePath}/browser-runtime/browser-runtime-manifest.json`;
const agentSkillsRelativePath = `${resourcesRelativePath}/agent-skills`;
const sparkleManifestRelativePath = `${resourcesRelativePath}/native/sparkle-runtime.json`;
const sparkleArtifactRelativePaths = {
  autoupdate: "Frameworks/Sparkle.framework/Versions/B/Autoupdate",
  bridge: "Resources/native/nodex-sparkle.node",
  frameworkExecutable: "Frameworks/Sparkle.framework/Versions/B/Sparkle",
  frameworkInfoPlist: "Frameworks/Sparkle.framework/Versions/B/Resources/Info.plist",
  updater: "Frameworks/Sparkle.framework/Versions/B/Updater.app/Contents/MacOS/Updater",
};

const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sha256Bytes = (value) => createHash("sha256").update(value).digest("hex");

const sha256File = (filePath) => {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(filePath, "r");
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) return hash.digest("hex");
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
};

const stableJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256StableJson = (value) => sha256Bytes(stableJson(value));

const readJson = (filePath, label) => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid: ${filePath}`, { cause: error });
  }
};

const requireSha256 = (value, label) => {
  if (typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)) return value;
  throw new Error(`${label} must be a SHA-256 digest`);
};

const requirePositiveSize = (value, label) => {
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new Error(`${label} must be a positive file size`);
};

const requireString = (value, label) => {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${label} must be a non-empty string`);
};

const assertExactKeys = (value, expected, label) => {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} has an unsupported shape`);
  }
};

const parsePreparedManifest = (value) => {
  if (!isObject(value) || value.schemaVersion !== PREPARED_SCHEMA_VERSION) {
    throw new Error("Packaged prepared Electron manifest is unsupported");
  }
  requireSha256(value.generationId, "Prepared Electron generationId");
  requireSha256(value.inputDigest, "Prepared Electron inputDigest");
  if (!isObject(value.product)) {
    throw new Error("Prepared Electron product metadata is invalid");
  }
  requireString(value.product.name, "Prepared Electron product name");
  requireString(value.product.version, "Prepared Electron product version");
  assertExactKeys(
    value.agentSkills,
    ["manifestSha256", "treeSha256"],
    "Prepared Electron Agent Skills",
  );
  requireSha256(
    value.agentSkills.manifestSha256,
    "Prepared Electron Agent Skills manifestSha256",
  );
  requireSha256(
    value.agentSkills.treeSha256,
    "Prepared Electron Agent Skills treeSha256",
  );
  const { generationId, ...withoutGeneration } = value;
  if (sha256Bytes(JSON.stringify(withoutGeneration)) !== generationId) {
    throw new Error("Packaged prepared Electron generation identity is invalid");
  }
  return value;
};

const fileIdentity = (appPath, relativePath) => {
  const filePath = path.join(appPath, ...relativePath.split("/"));
  const metadata = lstatSync(filePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Packaged provenance payload must be a regular file: ${relativePath}`);
  }
  return {
    path: relativePath.slice(resourcesRelativePath.length + 1),
    sha256: sha256File(filePath),
    size: metadata.size,
  };
};

const optionalFileIdentity = (appPath, relativePath) => (
  existsSync(path.join(appPath, ...relativePath.split("/")))
    ? fileIdentity(appPath, relativePath)
    : null
);

const isBrowserRuntimeCompatible = (browserManifest, agentManifest) => (
  browserManifest === null
    || isBrowserRuntimeCompatibleWithCodex(
      browserManifest,
      agentManifest.codexCompatibilityVersion,
    )
);

const contentsFileIdentity = (appPath, relativePath) => {
  const filePath = path.join(appPath, "Contents", ...relativePath.split("/"));
  const metadata = lstatSync(filePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Packaged provenance payload must be a regular file: ${relativePath}`);
  }
  return {
    path: relativePath,
    sha256: sha256File(filePath),
    size: metadata.size,
  };
};

const parseFileIdentity = (value, expectedPath, label) => {
  assertExactKeys(value, ["path", "sha256", "size"], label);
  if (value.path !== expectedPath) throw new Error(`${label} path is invalid`);
  return {
    path: expectedPath,
    sha256: requireSha256(value.sha256, `${label} sha256`),
    size: requirePositiveSize(value.size, `${label} size`),
  };
};

const verifyFileIdentity = (appPath, actual, relativePath, label) => {
  const expected = fileIdentity(appPath, relativePath);
  if (
    actual.path !== expected.path
    || actual.sha256 !== expected.sha256
    || actual.size !== expected.size
  ) {
    throw new Error(`${label} does not match the packaged provenance`);
  }
};

const verifyContentsFileIdentity = (appPath, actual, relativePath, label) => {
  const expected = contentsFileIdentity(appPath, relativePath);
  if (
    actual.path !== expected.path
    || actual.sha256 !== expected.sha256
    || actual.size !== expected.size
  ) {
    throw new Error(`${label} does not match the packaged provenance`);
  }
};

const parseSparkleRuntimeManifest = (value) => {
  if (!isObject(value) || value.schemaVersion !== 2 || !isObject(value.artifacts)) {
    throw new Error("Packaged Sparkle runtime manifest is unsupported");
  }
  if (value.architecture !== "arm64" && value.architecture !== "x64") {
    throw new Error("Packaged Sparkle runtime architecture is invalid");
  }
  if (value.channel !== "disabled" && value.channel !== "stable") {
    throw new Error("Packaged Sparkle runtime channel is invalid");
  }
  if (
    (value.channel === "disabled" && value.feedUrl !== null)
    || (value.channel === "stable" && (
      typeof value.feedUrl !== "string"
      || value.feedUrl !== `https://nodex.jyu.app/updates/stable/${value.architecture}/appcast.xml`
    ))
  ) {
    throw new Error("Packaged Sparkle runtime feed is invalid");
  }
  if (
    typeof value.publicKey !== "string"
    || !/^[A-Za-z0-9+/]{43}=$/u.test(value.publicKey)
    || Buffer.from(value.publicKey, "base64").length !== 32
    || value.minimumMacOS !== "12.0"
    || typeof value.sparkleVersion !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.sparkleArchiveSha256)
  ) {
    throw new Error("Packaged Sparkle runtime identity is invalid");
  }
  for (const [name, relativePath] of Object.entries(sparkleArtifactRelativePaths)) {
    parseFileIdentity(
      value.artifacts[name],
      relativePath,
      `Packaged Sparkle ${name}`,
    );
  }
  return value;
};

export const writePackagedBuildProvenance = (appPath) => {
  const resolvedAppPath = path.resolve(appPath);
  const preparedPath = path.join(resolvedAppPath, ...preparedRelativePath.split("/"));
  const prepared = parsePreparedManifest(
    readJson(preparedPath, "Packaged prepared Electron manifest"),
  );
  const nativeManifest = readJson(
    path.join(resolvedAppPath, ...nativeManifestRelativePath.split("/")),
    "Packaged native runtime manifest",
  );
  const agentManifest = readJson(
    path.join(resolvedAppPath, ...agentManifestRelativePath.split("/")),
    "Packaged Agent runtime manifest",
  );
  const browserManifestPath = path.join(
    resolvedAppPath,
    ...browserManifestRelativePath.split("/"),
  );
  const browserManifest = existsSync(browserManifestPath)
    ? readJson(browserManifestPath, "Packaged Browser runtime manifest")
    : null;
  const sparkleManifestPath = path.join(
    resolvedAppPath,
    ...sparkleManifestRelativePath.split("/"),
  );
  const sparkleManifest = parseSparkleRuntimeManifest(
    readJson(sparkleManifestPath, "Packaged Sparkle runtime manifest"),
  );
  const sparkleArtifacts = Object.fromEntries(Object.entries(
    sparkleArtifactRelativePaths,
  ).map(([name, relativePath]) => [
    name,
    contentsFileIdentity(resolvedAppPath, relativePath),
  ]));
  const agentSkills = inspectOfficialAgentSkillsArtifact(
    path.join(resolvedAppPath, ...agentSkillsRelativePath.split("/")),
  );
  for (const name of Object.keys(sparkleArtifactRelativePaths)) {
    if (
      sparkleManifest.artifacts[name].path !== sparkleArtifacts[name].path
      || sparkleManifest.artifacts[name].sha256 !== sparkleArtifacts[name].sha256
      || sparkleManifest.artifacts[name].size !== sparkleArtifacts[name].size
    ) {
      throw new Error(`Packaged Sparkle ${name} manifest identity does not match its artifact`);
    }
  }
  if (
    agentSkills.manifestSha256 !== prepared.agentSkills.manifestSha256
    || agentSkills.treeSha256 !== prepared.agentSkills.treeSha256
    || agentSkills.releaseVersion !== prepared.product.version
  ) {
    throw new Error("Packaged Agent Skills do not match the prepared Electron source");
  }
  const targetArch = nativeManifest.targetArch;
  if (
    nativeManifest.targetPlatform !== "darwin"
    || (targetArch !== "arm64" && targetArch !== "x64")
    || nativeManifest.productVersion !== prepared.product.version
    || agentManifest.targetPlatform !== "darwin"
    || agentManifest.targetArch !== targetArch
    || sparkleManifest.architecture !== targetArch
    || (browserManifest !== null && (
      browserManifest.targetPlatform !== "darwin"
      || browserManifest.targetArch !== targetArch
      || !isBrowserRuntimeCompatible(browserManifest, agentManifest)
    ))
  ) {
    throw new Error("Packaged runtime targets do not agree");
  }

  const body = {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    product: {
      name: prepared.product.name,
      version: prepared.product.version,
    },
    target: {
      platform: "darwin",
      arch: targetArch,
    },
    preparedElectron: {
      generationId: prepared.generationId,
      manifestSha256: sha256File(preparedPath),
    },
    agentSkills: {
      manifestSha256: agentSkills.manifestSha256,
      treeSha256: agentSkills.treeSha256,
    },
    payload: {
      appAsar: fileIdentity(resolvedAppPath, appAsarRelativePath),
      nativeRuntimeManifest: fileIdentity(resolvedAppPath, nativeManifestRelativePath),
      agentRuntimeManifest: fileIdentity(resolvedAppPath, agentManifestRelativePath),
      browserRuntimeManifest: optionalFileIdentity(
        resolvedAppPath,
        browserManifestRelativePath,
      ),
      sparkle: {
        artifacts: sparkleArtifacts,
        channel: sparkleManifest.channel,
        feedUrl: sparkleManifest.feedUrl,
        publicKey: sparkleManifest.publicKey,
        runtimeManifest: fileIdentity(resolvedAppPath, sparkleManifestRelativePath),
        sparkleVersion: sparkleManifest.sparkleVersion,
      },
    },
  };
  const manifest = {
    ...body,
    provenanceId: sha256StableJson(body),
  };
  const provenancePath = path.join(
    resolvedAppPath,
    ...provenanceRelativePath.split("/"),
  );
  const temporaryPath = `${provenancePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o644,
    });
    renameSync(temporaryPath, provenancePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return manifest;
};

export const verifyPackagedBuildProvenance = (
  appPath,
  options = {},
) => {
  const resolvedAppPath = path.resolve(appPath);
  const provenancePath = path.join(
    resolvedAppPath,
    ...provenanceRelativePath.split("/"),
  );
  const value = readJson(provenancePath, "Packaged build provenance");
  assertExactKeys(value, [
    "schemaVersion",
    "product",
    "target",
    "preparedElectron",
    "agentSkills",
    "payload",
    "provenanceId",
  ], "Packaged build provenance");
  if (value.schemaVersion !== PROVENANCE_SCHEMA_VERSION) {
    throw new Error("Packaged build provenance schema is unsupported");
  }
  const { provenanceId, ...body } = value;
  if (
    requireSha256(provenanceId, "Packaged provenanceId")
    !== sha256StableJson(body)
  ) {
    throw new Error("Packaged build provenance identity is invalid");
  }
  assertExactKeys(value.product, ["name", "version"], "Packaged product");
  requireString(value.product.name, "Packaged product name");
  requireString(value.product.version, "Packaged product version");
  assertExactKeys(value.target, ["platform", "arch"], "Packaged target");
  if (
    value.target.platform !== "darwin"
    || (value.target.arch !== "arm64" && value.target.arch !== "x64")
  ) {
    throw new Error("Packaged build target is invalid");
  }
  if (options.expectedArch && value.target.arch !== options.expectedArch) {
    throw new Error(
      `Packaged build provenance is ${value.target.arch}, expected ${options.expectedArch}`,
    );
  }
  assertExactKeys(
    value.preparedElectron,
    ["generationId", "manifestSha256"],
    "Packaged prepared Electron identity",
  );
  requireSha256(
    value.preparedElectron.generationId,
    "Packaged prepared Electron generationId",
  );
  assertExactKeys(
    value.agentSkills,
    ["manifestSha256", "treeSha256"],
    "Packaged Agent Skills identity",
  );
  requireSha256(
    value.agentSkills.manifestSha256,
    "Packaged Agent Skills manifestSha256",
  );
  requireSha256(
    value.agentSkills.treeSha256,
    "Packaged Agent Skills treeSha256",
  );
  requireSha256(
    value.preparedElectron.manifestSha256,
    "Packaged prepared Electron manifestSha256",
  );
  assertExactKeys(
    value.payload,
    [
      "appAsar",
      "nativeRuntimeManifest",
      "agentRuntimeManifest",
      "browserRuntimeManifest",
      "sparkle",
    ],
    "Packaged payload",
  );
  const appAsar = parseFileIdentity(value.payload.appAsar, "app.asar", "Packaged app.asar");
  const nativeRuntimeManifest = parseFileIdentity(
    value.payload.nativeRuntimeManifest,
    "bin/rust-core-runtime.json",
    "Packaged native runtime manifest",
  );
  const agentRuntimeManifest = parseFileIdentity(
    value.payload.agentRuntimeManifest,
    "agent-runtime.json",
    "Packaged Agent runtime manifest",
  );
  const browserRuntimeManifest = value.payload.browserRuntimeManifest === null
    ? null
    : parseFileIdentity(
        value.payload.browserRuntimeManifest,
        "browser-runtime/browser-runtime-manifest.json",
        "Packaged Browser runtime manifest",
      );
  assertExactKeys(
    value.payload.sparkle,
    ["artifacts", "channel", "feedUrl", "publicKey", "runtimeManifest", "sparkleVersion"],
    "Packaged Sparkle identity",
  );
  const sparkleRuntimeManifest = parseFileIdentity(
    value.payload.sparkle.runtimeManifest,
    "native/sparkle-runtime.json",
    "Packaged Sparkle runtime manifest",
  );
  assertExactKeys(
    value.payload.sparkle.artifacts,
    Object.keys(sparkleArtifactRelativePaths),
    "Packaged Sparkle artifacts",
  );
  const sparkleArtifacts = Object.fromEntries(Object.entries(
    sparkleArtifactRelativePaths,
  ).map(([name, relativePath]) => [name, parseFileIdentity(
    value.payload.sparkle.artifacts[name],
    relativePath,
    `Packaged Sparkle ${name}`,
  )]));

  const preparedPath = path.join(resolvedAppPath, ...preparedRelativePath.split("/"));
  const prepared = parsePreparedManifest(
    readJson(preparedPath, "Packaged prepared Electron manifest"),
  );
  const agentSkills = inspectOfficialAgentSkillsArtifact(
    path.join(resolvedAppPath, ...agentSkillsRelativePath.split("/")),
  );
  if (
    sha256File(preparedPath) !== value.preparedElectron.manifestSha256
    || prepared.generationId !== value.preparedElectron.generationId
    || prepared.product.name !== value.product.name
    || prepared.product.version !== value.product.version
    || prepared.agentSkills.manifestSha256 !== value.agentSkills.manifestSha256
    || prepared.agentSkills.treeSha256 !== value.agentSkills.treeSha256
    || agentSkills.manifestSha256 !== value.agentSkills.manifestSha256
    || agentSkills.treeSha256 !== value.agentSkills.treeSha256
    || agentSkills.releaseVersion !== value.product.version
  ) {
    throw new Error("Packaged prepared Electron manifest does not match provenance");
  }
  if (options.expectedPreparedManifestPath) {
    const expectedPreparedPath = path.resolve(options.expectedPreparedManifestPath);
    const expectedPrepared = parsePreparedManifest(
      readJson(expectedPreparedPath, "Current prepared Electron manifest"),
    );
    if (
      sha256File(expectedPreparedPath) !== value.preparedElectron.manifestSha256
      || expectedPrepared.generationId !== value.preparedElectron.generationId
    ) {
      throw new Error("Packaged build is stale for the current prepared Electron source");
    }
  }

  verifyFileIdentity(resolvedAppPath, appAsar, appAsarRelativePath, "Packaged app.asar");
  verifyFileIdentity(
    resolvedAppPath,
    nativeRuntimeManifest,
    nativeManifestRelativePath,
    "Packaged native runtime manifest",
  );
  verifyFileIdentity(
    resolvedAppPath,
    agentRuntimeManifest,
    agentManifestRelativePath,
    "Packaged Agent runtime manifest",
  );
  if (browserRuntimeManifest) {
    verifyFileIdentity(
      resolvedAppPath,
      browserRuntimeManifest,
      browserManifestRelativePath,
      "Packaged Browser runtime manifest",
    );
  } else if (existsSync(path.join(resolvedAppPath, ...browserManifestRelativePath.split("/")))) {
    throw new Error("Packaged Browser runtime manifest is not bound by provenance");
  }
  verifyFileIdentity(
    resolvedAppPath,
    sparkleRuntimeManifest,
    sparkleManifestRelativePath,
    "Packaged Sparkle runtime manifest",
  );
  for (const [name, relativePath] of Object.entries(sparkleArtifactRelativePaths)) {
    verifyContentsFileIdentity(
      resolvedAppPath,
      sparkleArtifacts[name],
      relativePath,
      `Packaged Sparkle ${name}`,
    );
  }
  const nativeManifest = readJson(
    path.join(resolvedAppPath, ...nativeManifestRelativePath.split("/")),
    "Packaged native runtime manifest",
  );
  const agentManifest = readJson(
    path.join(resolvedAppPath, ...agentManifestRelativePath.split("/")),
    "Packaged Agent runtime manifest",
  );
  const browserManifest = browserRuntimeManifest
    ? readJson(
        path.join(resolvedAppPath, ...browserManifestRelativePath.split("/")),
        "Packaged Browser runtime manifest",
      )
    : null;
  const sparkleManifest = parseSparkleRuntimeManifest(
    readJson(
      path.join(resolvedAppPath, ...sparkleManifestRelativePath.split("/")),
      "Packaged Sparkle runtime manifest",
    ),
  );
  for (const name of Object.keys(sparkleArtifactRelativePaths)) {
    if (
      sparkleManifest.artifacts[name].path !== sparkleArtifacts[name].path
      || sparkleManifest.artifacts[name].sha256 !== sparkleArtifacts[name].sha256
      || sparkleManifest.artifacts[name].size !== sparkleArtifacts[name].size
    ) {
      throw new Error(`Packaged Sparkle ${name} manifest identity does not match provenance`);
    }
  }
  if (
    nativeManifest.targetPlatform !== value.target.platform
    || nativeManifest.targetArch !== value.target.arch
    || nativeManifest.productVersion !== value.product.version
    || agentManifest.targetPlatform !== value.target.platform
    || agentManifest.targetArch !== value.target.arch
    || sparkleManifest.architecture !== value.target.arch
    || sparkleManifest.channel !== value.payload.sparkle.channel
    || sparkleManifest.feedUrl !== value.payload.sparkle.feedUrl
    || sparkleManifest.publicKey !== value.payload.sparkle.publicKey
    || sparkleManifest.sparkleVersion !== value.payload.sparkle.sparkleVersion
    || (browserManifest !== null && (
      browserManifest.targetPlatform !== value.target.platform
      || browserManifest.targetArch !== value.target.arch
      || !isBrowserRuntimeCompatible(browserManifest, agentManifest)
    ))
  ) {
    throw new Error("Packaged runtime target does not match provenance");
  }
  return value;
};
