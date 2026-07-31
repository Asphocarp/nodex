import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { dump, load } from "js-yaml";
import { normalizeStableVersion, sha256File, tagForVersion } from "./model";

export type MacArchitecture = "arm64" | "x64";

export interface ReleaseArtifactIdentity {
  readonly architecture?: MacArchitecture;
  readonly bytes: number;
  readonly name: string;
  readonly role: "blockmap" | "dmg" | "update-manifest" | "zip";
  readonly sha256: string;
}

export interface AgentSkillsIdentity {
  readonly manifestSha256: string;
  readonly treeSha256: string;
}

export interface ArchitectureBuildManifest {
  readonly agentSkills: AgentSkillsIdentity;
  readonly architecture: MacArchitecture;
  readonly artifacts: readonly ReleaseArtifactIdentity[];
  readonly packageProvenanceSha256: string;
  readonly preparedBuild: {
    readonly generation: string;
    readonly manifestSha256: string;
    readonly state: "clean";
  };
  readonly runner: Readonly<Record<string, string>>;
  readonly runtimeLocks: {
    readonly agentSha256: string;
    readonly browserSha256: string;
  };
  readonly schemaVersion: 1;
  readonly sourceSha: string;
  readonly sourceTree: string;
  readonly tag: string;
  readonly version: string;
}

export interface ReleaseBundleManifest {
  readonly agentSkills: AgentSkillsIdentity;
  readonly architectures: Readonly<Record<MacArchitecture, {
    readonly manifestSha256: string;
    readonly preparedBuildGeneration: string;
  }>>;
  readonly assets: readonly ReleaseArtifactIdentity[];
  readonly runtimeLocks: ArchitectureBuildManifest["runtimeLocks"];
  readonly schemaVersion: 1;
  readonly sourceSha: string;
  readonly sourceTree: string;
  readonly tag: string;
  readonly version: string;
}

interface UpdateFileInfo {
  readonly sha512: string;
  readonly size?: number;
  readonly url: string;
  readonly [key: string]: unknown;
}

interface MacUpdateManifest {
  readonly files?: readonly UpdateFileInfo[];
  readonly path?: string;
  readonly releaseDate?: string;
  readonly releaseName?: string;
  readonly releaseNotes?: unknown;
  readonly sha512?: string;
  readonly version: string;
  readonly [key: string]: unknown;
}

const SHA_PATTERN = /^[a-f0-9]{64}$/;
const ARTIFACT_ROLES = new Set<ReleaseArtifactIdentity["role"]>([
  "blockmap",
  "dmg",
  "update-manifest",
  "zip",
]);

const assertSha = (value: string, label: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 hex digest.`);
  return normalized;
};

const parseAgentSkillsIdentity = (
  value: unknown,
  label: string,
): AgentSkillsIdentity => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  const candidate = value as Partial<AgentSkillsIdentity>;
  if (
    JSON.stringify(Object.keys(candidate).sort())
    !== JSON.stringify(["manifestSha256", "treeSha256"])
  ) {
    throw new Error(`${label} has an unsupported shape.`);
  }
  return {
    manifestSha256: assertSha(
      candidate.manifestSha256 ?? "",
      `${label} manifest`,
    ),
    treeSha256: assertSha(candidate.treeSha256 ?? "", `${label} tree`),
  };
};

const assertRegularFile = (filePath: string): void => {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Release artifact must be a regular file: ${filePath}`);
  }
};

const artifactIdentity = (
  filePath: string,
  role: ReleaseArtifactIdentity["role"],
  architecture?: MacArchitecture,
): ReleaseArtifactIdentity => {
  assertRegularFile(filePath);
  const stats = lstatSync(filePath);
  return {
    architecture,
    bytes: stats.size,
    name: basename(filePath),
    role,
    sha256: sha256File(filePath),
  };
};

const readJson = (filePath: string): unknown => JSON.parse(readFileSync(filePath, "utf8")) as unknown;

const parseArtifact = (value: unknown): ReleaseArtifactIdentity => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Architecture artifact identity is invalid.");
  }
  const candidate = value as Partial<ReleaseArtifactIdentity>;
  if (
    typeof candidate.name !== "string"
    || typeof candidate.bytes !== "number"
    || !Number.isSafeInteger(candidate.bytes)
    || candidate.bytes <= 0
    || typeof candidate.sha256 !== "string"
    || typeof candidate.role !== "string"
    || !ARTIFACT_ROLES.has(candidate.role as ReleaseArtifactIdentity["role"])
    || (candidate.architecture !== undefined && candidate.architecture !== "arm64" && candidate.architecture !== "x64")
  ) {
    throw new Error("Architecture artifact identity is invalid.");
  }
  if (basename(candidate.name) !== candidate.name || candidate.name === "." || candidate.name === "..") {
    throw new Error("Architecture artifact name must be a safe basename.");
  }
  return { ...candidate, sha256: assertSha(candidate.sha256, `artifact ${candidate.name}`) } as ReleaseArtifactIdentity;
};

export function parseArchitectureBuildManifest(value: unknown): ArchitectureBuildManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Architecture build manifest is invalid.");
  }
  const candidate = value as Partial<ArchitectureBuildManifest>;
  if (
    candidate.schemaVersion !== 1
    || !candidate.agentSkills
    || (candidate.architecture !== "arm64" && candidate.architecture !== "x64")
    || typeof candidate.version !== "string"
    || typeof candidate.tag !== "string"
    || typeof candidate.sourceSha !== "string"
    || typeof candidate.sourceTree !== "string"
    || !candidate.preparedBuild
    || candidate.preparedBuild.state !== "clean"
    || !candidate.runtimeLocks
    || typeof candidate.packageProvenanceSha256 !== "string"
    || !Array.isArray(candidate.artifacts)
    || !candidate.runner
  ) {
    throw new Error("Architecture build manifest is invalid.");
  }
  const version = normalizeStableVersion(candidate.version);
  if (candidate.tag !== tagForVersion(version)) throw new Error("Architecture build tag does not match its version.");
  if (!/^[a-f0-9]{40}$/.test(candidate.sourceSha) || !/^[a-f0-9]{40}$/.test(candidate.sourceTree)) {
    throw new Error("Architecture build source identity is invalid.");
  }
  assertSha(candidate.preparedBuild.generation, "prepared build generation");
  assertSha(candidate.preparedBuild.manifestSha256, "prepared build manifest");
  assertSha(candidate.runtimeLocks.agentSha256, "Agent runtime lock");
  assertSha(candidate.runtimeLocks.browserSha256, "Browser runtime lock");
  assertSha(candidate.packageProvenanceSha256, "package provenance");
  return {
    ...candidate,
    agentSkills: parseAgentSkillsIdentity(
      candidate.agentSkills,
      "Architecture Agent Skills identity",
    ),
    artifacts: candidate.artifacts.map(parseArtifact),
    version,
  } as ArchitectureBuildManifest;
}

export function parseReleaseBundleManifest(value: unknown): ReleaseBundleManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Release Bundle manifest is invalid.");
  }
  const candidate = value as Partial<ReleaseBundleManifest>;
  if (
    candidate.schemaVersion !== 1
    || !candidate.agentSkills
    || typeof candidate.version !== "string"
    || typeof candidate.tag !== "string"
    || typeof candidate.sourceSha !== "string"
    || typeof candidate.sourceTree !== "string"
    || !candidate.architectures?.arm64
    || !candidate.architectures.x64
    || !candidate.runtimeLocks
    || !Array.isArray(candidate.assets)
  ) {
    throw new Error("Release Bundle manifest is invalid.");
  }
  const version = normalizeStableVersion(candidate.version);
  if (candidate.tag !== tagForVersion(version)) throw new Error("Release Bundle tag does not match its version.");
  if (!/^[a-f0-9]{40}$/u.test(candidate.sourceSha) || !/^[a-f0-9]{40}$/u.test(candidate.sourceTree)) {
    throw new Error("Release Bundle source identity is invalid.");
  }
  assertSha(candidate.runtimeLocks.agentSha256, "Release Bundle Agent runtime lock");
  assertSha(candidate.runtimeLocks.browserSha256, "Release Bundle Browser runtime lock");
  const agentSkills = parseAgentSkillsIdentity(
    candidate.agentSkills,
    "Release Bundle Agent Skills identity",
  );
  for (const architecture of ["arm64", "x64"] as const) {
    assertSha(candidate.architectures[architecture].manifestSha256, `${architecture} architecture manifest`);
    assertSha(candidate.architectures[architecture].preparedBuildGeneration, `${architecture} prepared build generation`);
  }
  const assets = candidate.assets.map(parseArtifact);
  const names = assets.map(({ name }) => name);
  if (new Set(names).size !== names.length) throw new Error("Release Bundle contains duplicate asset names.");
  const expectedAssets = [
    { architecture: "arm64", name: "Nodex-latest-arm64.dmg", role: "dmg" },
    { architecture: "x64", name: "Nodex-latest-x64.dmg", role: "dmg" },
    { architecture: "arm64", name: `Nodex-${version}-arm64.zip`, role: "zip" },
    { architecture: "arm64", name: `Nodex-${version}-arm64.zip.blockmap`, role: "blockmap" },
    { architecture: "x64", name: `Nodex-${version}-x64.zip`, role: "zip" },
    { architecture: "x64", name: `Nodex-${version}-x64.zip.blockmap`, role: "blockmap" },
    { architecture: undefined, name: "latest-mac.yml", role: "update-manifest" },
  ] as const;
  const actualContract = assets
    .map(({ architecture, name, role }) => ({ architecture, name, role }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const expectedContract = [...expectedAssets].sort((left, right) => left.name.localeCompare(right.name));
  if (JSON.stringify(actualContract) !== JSON.stringify(expectedContract)) {
    throw new Error("Release Bundle assets do not match the stable application allowlist.");
  }
  return { ...candidate, agentSkills, assets, version } as ReleaseBundleManifest;
}

const ensureEmptyDirectory = (directory: string): void => {
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new Error(`Release output directory must be empty: ${directory}`);
  }
  mkdirSync(directory, { recursive: true });
};

const commandVersion = (command: string, args: readonly string[]): string => {
  try {
    return execFileSync(command, [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .split("\n")[0];
  } catch {
    return "unavailable";
  }
};

export function recordArchitectureBuild(options: {
  readonly appPath: string;
  readonly architecture: MacArchitecture;
  readonly cwd: string;
  readonly distDirectory: string;
  readonly outputDirectory: string;
  readonly sourceSha: string;
  readonly version: string;
}): ArchitectureBuildManifest {
  const cwd = resolve(options.cwd);
  const version = normalizeStableVersion(options.version);
  const sourceSha = options.sourceSha.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Source SHA must be a full commit SHA.");
  const actualHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd, encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd, encoding: "utf8" }).trim();
  if (actualHead !== sourceSha || status) throw new Error("Architecture build must come from the exact clean source commit.");
  if (process.platform !== "darwin" || process.arch !== options.architecture) {
    throw new Error(`Architecture build must run natively on darwin ${options.architecture}.`);
  }

  const dist = resolve(options.distDirectory);
  const output = resolve(options.outputDirectory);
  ensureEmptyDirectory(output);
  const expected = [
    [`Nodex-${version}-${options.architecture}.dmg`, "dmg"],
    [`Nodex-${version}-${options.architecture}.zip`, "zip"],
    [`Nodex-${version}-${options.architecture}.zip.blockmap`, "blockmap"],
    ["latest-mac.yml", "update-manifest"],
  ] as const;
  const artifacts = expected.map(([name, role]) => {
    const source = join(dist, name);
    assertRegularFile(source);
    const target = join(output, name);
    copyFileSync(source, target);
    return artifactIdentity(target, role, options.architecture);
  });

  const preparedPath = join(cwd, ".generated/prepared-electron-build.json");
  const prepared = readJson(preparedPath) as {
    readonly generationId?: unknown;
    readonly product?: { readonly version?: unknown };
    readonly source?: { readonly baseCommit?: unknown; readonly baseTree?: unknown; readonly state?: unknown };
  };
  if (
    typeof prepared.generationId !== "string"
    || prepared.product?.version !== version
    || prepared.source?.state !== "clean"
    || prepared.source.baseCommit !== sourceSha
    || prepared.source.baseTree !== sourceTree
  ) {
    throw new Error("Prepared Electron build does not match the architecture release identity.");
  }
  const provenancePath = join(resolve(options.appPath), "Contents/Resources/nodex-build-provenance.json");
  assertRegularFile(provenancePath);
  const provenance = readJson(provenancePath) as {
    readonly agentSkills?: unknown;
  };
  const manifest: ArchitectureBuildManifest = {
    agentSkills: parseAgentSkillsIdentity(
      provenance.agentSkills,
      "Packaged Agent Skills identity",
    ),
    architecture: options.architecture,
    artifacts,
    packageProvenanceSha256: sha256File(provenancePath),
    preparedBuild: {
      generation: prepared.generationId,
      manifestSha256: sha256File(preparedPath),
      state: "clean",
    },
    runner: {
      image: process.env.ImageOS ?? process.env.RUNNER_OS ?? "local",
      imageVersion: process.env.ImageVersion ?? "unknown",
      node: process.version,
      pnpm: commandVersion("pnpm", ["--version"]),
      rust: commandVersion("rustc", ["--version"]),
    },
    runtimeLocks: {
      agentSha256: sha256File(join(cwd, "resources/agent-runtime/openinterpreter.lock.json")),
      browserSha256: sha256File(join(cwd, "resources/browser-runtime/browser-runtime.lock.json")),
    },
    schemaVersion: 1,
    sourceSha,
    sourceTree,
    tag: tagForVersion(version),
    version,
  };
  writeFileSync(join(output, "architecture-build.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

const readArchitectureDirectory = (directory: string): ArchitectureBuildManifest => {
  const root = resolve(directory);
  const manifest = parseArchitectureBuildManifest(readJson(join(root, "architecture-build.json")));
  const expectedContract = [
    { architecture: manifest.architecture, name: `Nodex-${manifest.version}-${manifest.architecture}.dmg`, role: "dmg" },
    { architecture: manifest.architecture, name: `Nodex-${manifest.version}-${manifest.architecture}.zip`, role: "zip" },
    {
      architecture: manifest.architecture,
      name: `Nodex-${manifest.version}-${manifest.architecture}.zip.blockmap`,
      role: "blockmap",
    },
    { architecture: manifest.architecture, name: "latest-mac.yml", role: "update-manifest" },
  ].sort((left, right) => left.name.localeCompare(right.name));
  const actualContract = manifest.artifacts
    .map(({ architecture, name, role }) => ({ architecture, name, role }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (JSON.stringify(actualContract) !== JSON.stringify(expectedContract)) {
    throw new Error(`${manifest.architecture} architecture artifacts do not match the release allowlist.`);
  }
  for (const artifact of manifest.artifacts) {
    const filePath = join(root, artifact.name);
    assertRegularFile(filePath);
    const actual = artifactIdentity(filePath, artifact.role, artifact.architecture);
    if (actual.bytes !== artifact.bytes || actual.sha256 !== artifact.sha256) {
      throw new Error(`Architecture artifact ${artifact.name} does not match its manifest.`);
    }
  }
  return manifest;
};

const sha512Base64 = (filePath: string): string => {
  const hash = createHash("sha512");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(filePath, "r");
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) return hash.digest("base64");
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
};

const normalizeUpdateFiles = (manifest: MacUpdateManifest): readonly UpdateFileInfo[] => {
  if (Array.isArray(manifest.files) && manifest.files.length > 0) return manifest.files;
  if (typeof manifest.path === "string" && typeof manifest.sha512 === "string") {
    return [{ url: manifest.path, sha512: manifest.sha512 }];
  }
  throw new Error("macOS update manifest does not contain any files.");
};

const readAndVerifyUpdateManifest = (
  directory: string,
  architecture: MacArchitecture,
  version: string,
): MacUpdateManifest => {
  const manifestPath = join(directory, "latest-mac.yml");
  const value = load(readFileSync(manifestPath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${architecture} latest-mac.yml.`);
  }
  const manifest = value as MacUpdateManifest;
  if (manifest.version !== version) throw new Error(`${architecture} update manifest version mismatch.`);
  const expectedName = `Nodex-${version}-${architecture}.zip`;
  const expectedPath = join(directory, expectedName);
  const files = normalizeUpdateFiles(manifest);
  if (files.length !== 1 || files[0].url !== expectedName) {
    throw new Error(`${architecture} update manifest must contain exactly ${expectedName}.`);
  }
  const expected = files[0];
  if (expected.sha512 !== sha512Base64(expectedPath)) {
    throw new Error(`${architecture} update manifest SHA512 does not match ${expectedName}.`);
  }
  if (expected.size !== undefined && expected.size !== lstatSync(expectedPath).size) {
    throw new Error(`${architecture} update manifest size does not match ${expectedName}.`);
  }
  return manifest;
};

export function assembleReleaseBundle(options: {
  readonly arm64Directory: string;
  readonly outputDirectory: string;
  readonly sourceSha: string;
  readonly version: string;
  readonly x64Directory: string;
}): ReleaseBundleManifest {
  const version = normalizeStableVersion(options.version);
  const sourceSha = options.sourceSha.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) throw new Error("Release source SHA must be a full commit SHA.");
  const arm64Root = resolve(options.arm64Directory);
  const x64Root = resolve(options.x64Directory);
  const output = resolve(options.outputDirectory);
  ensureEmptyDirectory(output);
  const arm64 = readArchitectureDirectory(arm64Root);
  const x64 = readArchitectureDirectory(x64Root);
  for (const manifest of [arm64, x64]) {
    if (manifest.version !== version || manifest.sourceSha !== sourceSha) {
      throw new Error("Architecture builds do not match the requested release identity.");
    }
  }
  if (
    arm64.architecture !== "arm64"
    || x64.architecture !== "x64"
    || arm64.sourceTree !== x64.sourceTree
    || JSON.stringify(arm64.agentSkills) !== JSON.stringify(x64.agentSkills)
    || JSON.stringify(arm64.runtimeLocks) !== JSON.stringify(x64.runtimeLocks)
  ) {
    throw new Error(
      "Architecture builds do not share one source tree, Agent Skills, and runtime lock identity.",
    );
  }

  const armUpdate = readAndVerifyUpdateManifest(arm64Root, "arm64", version);
  const x64Update = readAndVerifyUpdateManifest(x64Root, "x64", version);
  const copy = (root: string, sourceName: string, targetName = sourceName): string => {
    const target = join(output, targetName);
    copyFileSync(join(root, sourceName), target);
    return target;
  };
  const publicFiles: Array<{ architecture?: MacArchitecture; path: string; role: ReleaseArtifactIdentity["role"] }> = [
    { architecture: "arm64", path: copy(arm64Root, `Nodex-${version}-arm64.dmg`, "Nodex-latest-arm64.dmg"), role: "dmg" },
    { architecture: "x64", path: copy(x64Root, `Nodex-${version}-x64.dmg`, "Nodex-latest-x64.dmg"), role: "dmg" },
    { architecture: "arm64", path: copy(arm64Root, `Nodex-${version}-arm64.zip`), role: "zip" },
    { architecture: "arm64", path: copy(arm64Root, `Nodex-${version}-arm64.zip.blockmap`), role: "blockmap" },
    { architecture: "x64", path: copy(x64Root, `Nodex-${version}-x64.zip`), role: "zip" },
    { architecture: "x64", path: copy(x64Root, `Nodex-${version}-x64.zip.blockmap`), role: "blockmap" },
  ];
  const mergedFiles = [
    ...normalizeUpdateFiles(armUpdate),
    ...normalizeUpdateFiles(x64Update),
  ];
  if (new Set(mergedFiles.map((entry) => entry.url)).size !== mergedFiles.length) {
    throw new Error("Merged macOS update manifest contains duplicate URLs.");
  }
  const legacy = mergedFiles.find((entry) => entry.url.endsWith(".zip")) ?? mergedFiles[0];
  const mergedUpdate: MacUpdateManifest = {
    ...armUpdate,
    version,
    files: mergedFiles,
    path: legacy.url,
    sha512: legacy.sha512,
  };
  const updatePath = join(output, "latest-mac.yml");
  writeFileSync(updatePath, dump(mergedUpdate, { lineWidth: 120, noRefs: true }), "utf8");
  publicFiles.push({ path: updatePath, role: "update-manifest" });

  const assets = publicFiles
    .map((entry) => artifactIdentity(entry.path, entry.role, entry.architecture))
    .sort((left, right) => left.name.localeCompare(right.name));
  const manifest: ReleaseBundleManifest = {
    agentSkills: arm64.agentSkills,
    architectures: {
      arm64: {
        manifestSha256: sha256File(join(arm64Root, "architecture-build.json")),
        preparedBuildGeneration: arm64.preparedBuild.generation,
      },
      x64: {
        manifestSha256: sha256File(join(x64Root, "architecture-build.json")),
        preparedBuildGeneration: x64.preparedBuild.generation,
      },
    },
    assets,
    runtimeLocks: arm64.runtimeLocks,
    schemaVersion: 1,
    sourceSha: arm64.sourceSha,
    sourceTree: arm64.sourceTree,
    tag: tagForVersion(version),
    version,
  };
  const manifestPath = join(output, "release-bundle.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const checksumEntries = [
    ...assets.map(({ name, sha256 }) => ({ name, sha256 })),
    { name: basename(manifestPath), sha256: sha256File(manifestPath) },
  ].sort((left, right) => left.name.localeCompare(right.name));
  writeFileSync(
    join(output, "SHA256SUMS"),
    `${checksumEntries.map(({ name, sha256 }) => `${sha256}  ${name}`).join("\n")}\n`,
    "utf8",
  );
  return manifest;
}
