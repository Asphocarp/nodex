import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const BUILD_RESOURCE_FILENAMES = ["THIRD_PARTY_NOTICES.txt"] as const;
const BUILD_RESOURCE_TREE_FILENAMES = [
  ...BUILD_RESOURCE_FILENAMES,
  BUILD_RESOURCES_MANIFEST_FILENAME,
] as const;

export type BuildResourceFilename = (typeof BUILD_RESOURCE_FILENAMES)[number];

export interface BuildResourceOutput {
  readonly sha256: string;
  readonly size: number;
}

export interface BuildResourcesManifest {
  readonly outputs: Readonly<Record<BuildResourceFilename, BuildResourceOutput>>;
  readonly schemaVersion: 2;
}

export interface BuildResourcesInput {
  readonly outputRoot?: string;
  readonly repositoryRoot?: string;
}

const defaultRepositoryRoot = path.resolve(".");

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean => {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
};

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

const parseOutput = (value: unknown, filename: BuildResourceFilename): BuildResourceOutput => {
  if (!isObject(value) || !hasOnlyKeys(value, ["sha256", "size"])) {
    throw new Error(`Build resources manifest omits ${filename}`);
  }
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
  if (
    !isObject(value)
    || !hasOnlyKeys(value, ["outputs", "schemaVersion"])
    || value.schemaVersion !== 2
    || !isObject(value.outputs)
    || !hasOnlyKeys(value.outputs, BUILD_RESOURCE_FILENAMES)
  ) {
    throw new Error("Build resources manifest is invalid");
  }
  return {
    outputs: {
      "THIRD_PARTY_NOTICES.txt": parseOutput(
        value.outputs["THIRD_PARTY_NOTICES.txt"],
        "THIRD_PARTY_NOTICES.txt",
      ),
    },
    schemaVersion: 2,
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

const inspectOutput = (
  paths: BuildResourcesPaths,
  filename: BuildResourceFilename,
): BuildResourceOutput => {
  const outputPath = paths.noticesPath;
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

const verifyTreeInventory = (resourceRoot: string): void => {
  const rootStat = lstatSync(resourceRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Build resources root must be a real directory");
  }
  const entries = readdirSync(resourceRoot).sort();
  const expected = [...BUILD_RESOURCE_TREE_FILENAMES].sort();
  if (entries.length !== expected.length || entries.some((entry, index) => entry !== expected[index])) {
    throw new Error("Build resources tree contains an unexpected entry");
  }
};

export function verifyBuildResourceTree(resourceRoot: string): BuildResourcesManifest {
  const paths = pathsForRoot(path.resolve(resourceRoot));
  verifyTreeInventory(paths.root);
  const manifest = readManifest(paths.root);
  for (const filename of BUILD_RESOURCE_FILENAMES) {
    const actual = inspectOutput(paths, filename);
    const expected = manifest.outputs[filename];
    if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
      throw new Error(`Build resource ${filename} does not match its manifest`);
    }
  }
  return manifest;
}

const buildStagedResources = async (
  repositoryRoot: string,
  resourceRoot: string,
): Promise<BuildResourcesManifest> => {
  const { generateThirdPartyNotices } = await import("./generate-third-party-notices");
  const paths = pathsForRoot(resourceRoot);
  mkdirSync(resourceRoot, { recursive: true });
  const notices = await generateThirdPartyNotices({ repositoryRoot });
  writeAtomic(paths.noticesPath, notices);

  const manifest: BuildResourcesManifest = {
    outputs: {
      "THIRD_PARTY_NOTICES.txt": inspectOutput(paths, "THIRD_PARTY_NOTICES.txt"),
    },
    schemaVersion: 2,
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
    for (const filename of BUILD_RESOURCE_TREE_FILENAMES) {
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
