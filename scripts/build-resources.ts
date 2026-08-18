import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LEGACY_PROFILE_MIGRATOR_BUNDLE_FILENAME,
  LEGACY_PROFILE_MIGRATOR_LEGAL_FILENAME,
  LEGACY_PROFILE_MIGRATOR_MANIFEST_FILENAME,
  LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
  verifyLegacyProfileMigratorArtifacts,
} from "./legacy-profile-migrator-artifacts";
import { sha256File } from "./native-runtime-manifest";
import {
  BUILD_RESOURCES_MANIFEST_FILENAME,
  buildResourcesPathsAtRoot,
  resolveBuildResources,
} from "../src/shared/build-resources";
import type { BuildResourcesPaths } from "../src/shared/build-resources";

export {
  BUILD_RESOURCES_DIRECTORY,
  BUILD_RESOURCES_MANIFEST_FILENAME,
  resolveBuildResources,
} from "../src/shared/build-resources";

const BUILD_RESOURCE_FILENAMES = [
  "THIRD_PARTY_NOTICES.txt",
  LEGACY_PROFILE_MIGRATOR_BUNDLE_FILENAME,
  LEGACY_PROFILE_MIGRATOR_LEGAL_FILENAME,
  LEGACY_PROFILE_MIGRATOR_MANIFEST_FILENAME,
] as const;

export type BuildResourceFilename = (typeof BUILD_RESOURCE_FILENAMES)[number];

export interface BuildResourceOutput {
  readonly sha256: string;
  readonly size: number;
}

export interface BuildResourcesInputs {
  readonly dependencyFingerprint: string;
  readonly esbuildVersion: string;
  readonly nodeVersion: string;
  readonly pnpmVersion: string;
  readonly repositoryLockfileSha256: string;
  readonly repositoryPackageJsonSha256: string;
  readonly sourceCommit: typeof LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT;
  readonly sourceLockfileSha256: string;
  readonly sourcePackageJsonSha256: string;
  readonly sourceWorkspaceSha256: string;
}

export interface BuildResourcesManifest {
  readonly inputs: BuildResourcesInputs;
  readonly outputs: Readonly<Record<BuildResourceFilename, BuildResourceOutput>>;
  readonly schemaVersion: 1;
}

export interface BuildResourcesInput {
  readonly outputRoot?: string;
  readonly repositoryRoot?: string;
}

const defaultRepositoryRoot = path.resolve(".");

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pathsForRoot = (root: string): BuildResourcesPaths => buildResourcesPathsAtRoot(root);

const resolveInput = (input: BuildResourcesInput): {
  readonly outputRoot: string;
  readonly repositoryRoot: string;
} => {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? defaultRepositoryRoot);
  const outputRoot = path.resolve(
    input.outputRoot ?? resolveBuildResources(repositoryRoot).root,
  );
  return { outputRoot, repositoryRoot };
};

const writeAtomic = (destination: string, contents: string | Uint8Array): void => {
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, contents);
    renameSync(temporaryPath, destination);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

const requireDigest = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Build resources manifest has an invalid ${label}`);
  }
  return value;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Build resources manifest has an invalid ${label}`);
  }
  return value;
};

const parseOutput = (value: unknown, filename: BuildResourceFilename): BuildResourceOutput => {
  if (!isObject(value)) throw new Error(`Build resources manifest omits ${filename}`);
  const size = value.size;
  if (!Number.isSafeInteger(size) || (size as number) <= 0) {
    throw new Error(`Build resources manifest has an invalid ${filename} size`);
  }
  return {
    sha256: requireDigest(value.sha256, `${filename} digest`),
    size: size as number,
  };
};

const parseManifest = (value: unknown): BuildResourcesManifest => {
  if (!isObject(value) || value.schemaVersion !== 1) {
    throw new Error("Build resources manifest is invalid");
  }
  if (!isObject(value.inputs) || !isObject(value.outputs)) {
    throw new Error("Build resources manifest is incomplete");
  }
  const inputs = value.inputs;
  const outputsValue = value.outputs;
  const sourceCommit = requireString(inputs.sourceCommit, "source commit");
  if (sourceCommit !== LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT) {
    throw new Error("Build resources manifest has an unexpected source commit");
  }
  const outputs = Object.fromEntries(
    BUILD_RESOURCE_FILENAMES.map((filename) => [filename, parseOutput(outputsValue[filename], filename)]),
  ) as Record<BuildResourceFilename, BuildResourceOutput>;
  return {
    inputs: {
      dependencyFingerprint: requireDigest(inputs.dependencyFingerprint, "dependency fingerprint"),
      esbuildVersion: requireString(inputs.esbuildVersion, "esbuild version"),
      nodeVersion: requireString(inputs.nodeVersion, "Node version"),
      pnpmVersion: requireString(inputs.pnpmVersion, "pnpm version"),
      repositoryLockfileSha256: requireDigest(
        inputs.repositoryLockfileSha256,
        "repository lockfile digest",
      ),
      repositoryPackageJsonSha256: requireDigest(
        inputs.repositoryPackageJsonSha256,
        "repository package manifest digest",
      ),
      sourceCommit: LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
      sourceLockfileSha256: requireDigest(inputs.sourceLockfileSha256, "source lockfile digest"),
      sourcePackageJsonSha256: requireDigest(
        inputs.sourcePackageJsonSha256,
        "source package manifest digest",
      ),
      sourceWorkspaceSha256: requireDigest(inputs.sourceWorkspaceSha256, "source workspace digest"),
    },
    outputs,
    schemaVersion: 1,
  };
};

const readManifest = (resourceRoot: string): BuildResourcesManifest => {
  const manifestPath = pathsForRoot(resourceRoot).manifestPath;
  let source: string;
  try {
    source = readFileSync(manifestPath, "utf8");
  } catch {
    throw new Error(`Build resources manifest is missing at ${manifestPath}`);
  }
  const manifest = parseManifest(JSON.parse(source) as unknown);
  if (source !== `${JSON.stringify(manifest, null, 2)}\n`) {
    throw new Error("Build resources manifest is not canonical");
  }
  return manifest;
};

const outputPathFor = (
  paths: BuildResourcesPaths,
  filename: BuildResourceFilename,
): string => {
  if (filename === "THIRD_PARTY_NOTICES.txt") return paths.noticesPath;
  if (filename === LEGACY_PROFILE_MIGRATOR_BUNDLE_FILENAME) return paths.legacyMigratorBundlePath;
  if (filename === LEGACY_PROFILE_MIGRATOR_LEGAL_FILENAME) return paths.legacyMigratorLegalPath;
  return paths.legacyMigratorManifestPath;
};

const inspectOutput = (
  paths: BuildResourcesPaths,
  filename: BuildResourceFilename,
): BuildResourceOutput => {
  const outputPath = outputPathFor(paths, filename);
  let stat;
  try {
    stat = lstatSync(outputPath);
  } catch {
    throw new Error(`Build resource ${filename} is missing at ${outputPath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Build resource ${filename} must be a regular file`);
  }
  return { sha256: sha256File(outputPath), size: stat.size };
};

export function verifyBuildResourceTree(resourceRoot: string): BuildResourcesManifest {
  const paths = pathsForRoot(path.resolve(resourceRoot));
  const manifest = readManifest(paths.root);
  for (const filename of BUILD_RESOURCE_FILENAMES) {
    const actual = inspectOutput(paths, filename);
    const expected = manifest.outputs[filename];
    if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
      throw new Error(`Build resource ${filename} does not match its manifest`);
    }
  }
  verifyLegacyProfileMigratorArtifacts(paths.root);
  return manifest;
}

const buildStagedResources = async (
  repositoryRoot: string,
  resourceRoot: string,
): Promise<BuildResourcesManifest> => {
  const [{ buildLegacyProfileMigrator }, { generateThirdPartyNotices }] = await Promise.all([
    import("./build-legacy-profile-migrator"),
    import("./generate-third-party-notices"),
  ]);
  const paths = pathsForRoot(resourceRoot);
  mkdirSync(resourceRoot, { recursive: true });
  const migrator = await buildLegacyProfileMigrator({ outputRoot: resourceRoot, repositoryRoot });
  const notices = await generateThirdPartyNotices({
    migratorLegalPath: paths.legacyMigratorLegalPath,
    repositoryRoot,
  });
  writeAtomic(paths.noticesPath, notices);
  verifyLegacyProfileMigratorArtifacts(resourceRoot);

  const manifest: BuildResourcesManifest = {
    inputs: {
      dependencyFingerprint: migrator.dependencyClosure.dependencyFingerprint,
      esbuildVersion: migrator.dependencyClosure.esbuildVersion,
      nodeVersion: migrator.dependencyClosure.nodeVersion,
      pnpmVersion: migrator.dependencyClosure.pnpmVersion,
      repositoryLockfileSha256: sha256File(path.join(repositoryRoot, "pnpm-lock.yaml")),
      repositoryPackageJsonSha256: sha256File(path.join(repositoryRoot, "package.json")),
      sourceCommit: migrator.manifest.sourceCommit,
      sourceLockfileSha256: migrator.dependencyClosure.sourceLockfileSha256,
      sourcePackageJsonSha256: migrator.dependencyClosure.sourcePackageJsonSha256,
      sourceWorkspaceSha256: migrator.dependencyClosure.sourceWorkspaceSha256,
    },
    outputs: Object.fromEntries(
      BUILD_RESOURCE_FILENAMES.map((filename) => [filename, inspectOutput(paths, filename)]),
    ) as Record<BuildResourceFilename, BuildResourceOutput>,
    schemaVersion: 1,
  };
  writeAtomic(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return verifyBuildResourceTree(resourceRoot);
};

const promoteDirectory = (stagedRoot: string, outputRoot: string): void => {
  mkdirSync(path.dirname(outputRoot), { recursive: true });
  const previousRoot = `${outputRoot}.${randomUUID()}.previous`;
  const hadPrevious = existsSync(outputRoot);
  if (hadPrevious) renameSync(outputRoot, previousRoot);
  try {
    renameSync(stagedRoot, outputRoot);
  } catch (error) {
    if (hadPrevious && !existsSync(outputRoot)) renameSync(previousRoot, outputRoot);
    throw error;
  } finally {
    if (existsSync(previousRoot)) rmSync(previousRoot, { force: true, recursive: true });
  }
};

const createStagingRoot = (outputRoot: string): string => {
  mkdirSync(path.dirname(outputRoot), { recursive: true });
  return mkdtempSync(path.join(path.dirname(outputRoot), ".build-resources-staging-"));
};

export async function prepareBuildResources(
  input: BuildResourcesInput = {},
): Promise<BuildResourcesManifest> {
  const { outputRoot, repositoryRoot } = resolveInput(input);
  const stagedRoot = createStagingRoot(outputRoot);
  try {
    await buildStagedResources(repositoryRoot, stagedRoot);
    promoteDirectory(stagedRoot, outputRoot);
    return verifyBuildResourceTree(outputRoot);
  } catch (error) {
    if (existsSync(stagedRoot)) rmSync(stagedRoot, { force: true, recursive: true });
    throw error;
  }
}

export async function verifyBuildResources(
  input: BuildResourcesInput = {},
): Promise<BuildResourcesManifest> {
  const { outputRoot, repositoryRoot } = resolveInput(input);
  const firstRoot = createStagingRoot(outputRoot);
  const secondRoot = createStagingRoot(outputRoot);
  try {
    await buildStagedResources(repositoryRoot, firstRoot);
    await buildStagedResources(repositoryRoot, secondRoot);
    for (const filename of [...BUILD_RESOURCE_FILENAMES, BUILD_RESOURCES_MANIFEST_FILENAME]) {
      const firstPath = path.join(firstRoot, filename);
      const secondPath = path.join(secondRoot, filename);
      if (!readFileSync(firstPath).equals(readFileSync(secondPath))) {
        throw new Error(`Build resource ${filename} is not reproducible`);
      }
    }
    promoteDirectory(firstRoot, outputRoot);
    return verifyBuildResourceTree(outputRoot);
  } finally {
    for (const root of [firstRoot, secondRoot]) {
      if (existsSync(root)) rmSync(root, { force: true, recursive: true });
    }
  }
}

const main = async (): Promise<void> => {
  const [command = "prepare", ...extraArguments] = process.argv.slice(2);
  if (extraArguments.length > 0 || (command !== "prepare" && command !== "verify")) {
    throw new Error("Usage: build-resources.ts <prepare|verify>");
  }
  const manifest = command === "verify"
    ? await verifyBuildResources()
    : await prepareBuildResources();
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
