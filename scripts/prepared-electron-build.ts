import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_SCHEMA_VERSION = 1;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultManifestPath = path.join(
  repositoryRoot,
  ".generated/prepared-electron-build.json",
);
const IGNORED_INPUT_DIRECTORY_NAMES = new Set([".turbo", "coverage", "dist", "node_modules"]);

const REQUIRED_INPUT_PATHS = [
  "config",
  "packages/codex-app-server-protocol",
  "packages/core-protocol",
  "resources/THIRD_PARTY_NOTICES.txt",
  "resources/icon.icon",
  "resources/icon.png",
  "resources/legacy-profile-migrator.json",
  "resources/legacy-profile-migrator.mjs",
  "resources/legacy-profile-migrator.mjs.LEGAL.txt",
  "resources/nodex-icon.svg",
  "resources/nodex-notification.aiff",
  "resources/third-party/open-interpreter",
  "scripts/build-legacy-profile-migrator.ts",
  "scripts/generate-third-party-notices.ts",
  "scripts/legacy-profile-migrator",
  "scripts/legacy-profile-migrator-artifacts.ts",
  "scripts/prepared-electron-build.ts",
  "scripts/sync-app-icons.ts",
  "src",
  "third_party/blocknote/packages",
  "Cargo.lock",
  "Cargo.toml",
  "electron.vite.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.web.json",
] as const;

const PREREQUISITE_SOURCE_PATHS = [
  "resources/icon.icon",
  "resources/nodex-icon.svg",
  "resources/third-party/open-interpreter",
  "scripts/build-legacy-profile-migrator.ts",
  "scripts/generate-third-party-notices.ts",
  "scripts/legacy-profile-migrator",
  "scripts/legacy-profile-migrator-artifacts.ts",
  "scripts/sync-app-icons.ts",
  "Cargo.lock",
  "Cargo.toml",
  "package.json",
  "pnpm-lock.yaml",
] as const;

interface FileDigest {
  readonly executable: boolean;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

interface PreparedElectronBuildManifest {
  readonly buildContext: Record<string, string>;
  readonly inputDigest: string;
  readonly outputs: readonly FileDigest[];
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
}

export interface PreparedElectronBuildOptions {
  readonly manifestPath?: string;
  readonly repositoryRoot: string;
}

const hashFile = (filePath: string): string => {
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

const normalizeRelativePath = (root: string, filePath: string): string =>
  path.relative(root, filePath).split(path.sep).join("/");

const collectFiles = (
  root: string,
  entryPath: string,
  ignoreGeneratedInputDirectories = false,
): FileDigest[] => {
  const stats = lstatSync(entryPath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Prepared build inputs and outputs must not be symlinks: ${entryPath}`);
  }
  if (stats.isFile()) {
    return [{
      executable: (stats.mode & 0o111) !== 0,
      path: normalizeRelativePath(root, entryPath),
      sha256: hashFile(entryPath),
      size: stats.size,
    }];
  }
  if (!stats.isDirectory()) {
    throw new Error(`Prepared build encountered an unsupported filesystem entry: ${entryPath}`);
  }
  return readdirSync(entryPath, { withFileTypes: true })
    .filter((entry) => (
      !ignoreGeneratedInputDirectories || !IGNORED_INPUT_DIRECTORY_NAMES.has(entry.name)
    ))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => collectFiles(
      root,
      path.join(entryPath, entry.name),
      ignoreGeneratedInputDirectories,
    ));
};

const collectCargoManifests = (root: string, currentPath: string): string[] =>
  readdirSync(currentPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): string[] => {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) return collectCargoManifests(root, entryPath);
      if (entry.isFile() && entry.name === "Cargo.toml") return [entryPath];
      return [];
    });

const buildContext = (): Record<string, string> => {
  const viteEnvironment = Object.entries(process.env)
    .filter(([key]) => key.startsWith("VITE_"))
    .sort(([left], [right]) => left.localeCompare(right));
  const sensitiveBuildVariables = [
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
    "SENTRY_RELEASE",
  ] as const;
  const digest = (value: string): string =>
    createHash("sha256").update(value).digest("hex");
  return Object.fromEntries([
    ["arch", process.arch],
    ["node", process.version],
    ["nodeEnv", process.env.NODE_ENV ?? ""],
    ["platform", process.platform],
    ...sensitiveBuildVariables.map((key) => [key, digest(process.env[key] ?? "")]),
    ...viteEnvironment.map(([key, value]) => [key, digest(value ?? "")]),
  ]);
};

const digestInventory = (
  files: readonly FileDigest[],
  context: Record<string, string>,
): string => createHash("sha256")
  .update(JSON.stringify({ context, files }))
  .digest("hex");

const inputInventory = (root: string): FileDigest[] => {
  const configuredInputs = REQUIRED_INPUT_PATHS.flatMap((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Prepared build input is missing: ${relativePath}`);
    }
    return collectFiles(root, absolutePath, true);
  });
  const cargoManifests = collectCargoManifests(root, path.join(root, "crates"))
    .flatMap((manifestPath) => collectFiles(root, manifestPath));
  const environmentFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.name === ".env" || entry.name.startsWith(".env."))
    .flatMap((entry) => collectFiles(root, path.join(root, entry.name)));
  return [...configuredInputs, ...cargoManifests, ...environmentFiles]
    .sort((left, right) => left.path.localeCompare(right.path));
};

const currentInputDigest = (root: string): string =>
  digestInventory(inputInventory(root), buildContext());

const currentPrerequisiteSourceDigest = (root: string): string => {
  const files = PREREQUISITE_SOURCE_PATHS.flatMap((relativePath) =>
    collectFiles(root, path.join(root, relativePath), true)
  );
  const cargoManifests = collectCargoManifests(root, path.join(root, "crates"))
    .flatMap((manifestPath) => collectFiles(root, manifestPath));
  return digestInventory(
    [...files, ...cargoManifests].sort((left, right) => left.path.localeCompare(right.path)),
    {},
  );
};

const outputInventory = (root: string): FileDigest[] => {
  const outputRoot = path.join(root, "out");
  if (!existsSync(outputRoot)) {
    throw new Error("Prepared Electron output is missing; run the normal build first.");
  }
  const files = collectFiles(root, outputRoot)
    .sort((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0) {
    throw new Error("Prepared Electron output is empty; run the normal build first.");
  }
  return files;
};

const manifestPathFor = (options: PreparedElectronBuildOptions): string =>
  path.resolve(
    options.manifestPath
      ?? path.join(options.repositoryRoot, ".generated/prepared-electron-build.json"),
  );

const writeManifest = (
  manifestPath: string,
  manifest: PreparedElectronBuildManifest,
): void => {
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, manifestPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

export function recordPreparedElectronBuild(
  options: PreparedElectronBuildOptions,
  expectedInputDigest?: string,
): PreparedElectronBuildManifest {
  const root = path.resolve(options.repositoryRoot);
  const beforeOutputs = currentInputDigest(root);
  if (expectedInputDigest && beforeOutputs !== expectedInputDigest) {
    throw new Error("Electron build inputs changed while the production build was running.");
  }
  const outputs = outputInventory(root);
  const afterOutputs = currentInputDigest(root);
  if (beforeOutputs !== afterOutputs) {
    throw new Error("Electron build inputs changed while outputs were being recorded.");
  }
  const manifest: PreparedElectronBuildManifest = {
    buildContext: buildContext(),
    inputDigest: afterOutputs,
    outputs,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
  };
  writeManifest(manifestPathFor(options), manifest);
  return manifest;
}

const parseManifest = (value: unknown): PreparedElectronBuildManifest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Prepared Electron build manifest is invalid.");
  }
  const candidate = value as Partial<PreparedElectronBuildManifest>;
  if (
    candidate.schemaVersion !== MANIFEST_SCHEMA_VERSION
    || typeof candidate.inputDigest !== "string"
    || !Array.isArray(candidate.outputs)
    || typeof candidate.buildContext !== "object"
    || candidate.buildContext === null
  ) {
    throw new Error("Prepared Electron build manifest is invalid.");
  }
  return candidate as PreparedElectronBuildManifest;
};

export function verifyPreparedElectronBuild(
  options: PreparedElectronBuildOptions,
): PreparedElectronBuildManifest {
  const root = path.resolve(options.repositoryRoot);
  const manifestPath = manifestPathFor(options);
  if (!existsSync(manifestPath)) {
    throw new Error("No prepared Electron build is available; run without --reuse-build first.");
  }
  let manifest: PreparedElectronBuildManifest;
  try {
    manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Prepared Electron")) throw error;
    throw new Error("Prepared Electron build manifest is invalid.", { cause: error });
  }
  if (manifest.inputDigest !== currentInputDigest(root)) {
    throw new Error("Prepared Electron build inputs are stale; run without --reuse-build first.");
  }
  const outputs = outputInventory(root);
  if (JSON.stringify(outputs) !== JSON.stringify(manifest.outputs)) {
    throw new Error("Prepared Electron build outputs are stale or damaged; run without --reuse-build first.");
  }
  return manifest;
}

function runProductionBuild(): void {
  rmSync(defaultManifestPath, { force: true });
  const beforePrerequisites = currentPrerequisiteSourceDigest(repositoryRoot);
  for (const script of [
    "legacy-profile-migrator:verify",
    "third-party-notices:generate",
    "sync:icons",
  ]) {
    execFileSync("pnpm", ["--silent", "run", script], {
      cwd: repositoryRoot,
      stdio: "inherit",
    });
  }
  if (beforePrerequisites !== currentPrerequisiteSourceDigest(repositoryRoot)) {
    throw new Error("Build prerequisite inputs changed while generated resources were prepared.");
  }
  const beforeBuild = currentInputDigest(repositoryRoot);
  execFileSync(
    "pnpm",
    ["exec", "electron-vite", "build", "--logLevel", "warn"],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  recordPreparedElectronBuild(
    { repositoryRoot, manifestPath: defaultManifestPath },
    beforeBuild,
  );
}

function main(): void {
  const [command, ...extraArguments] = process.argv.slice(2);
  if (extraArguments.length > 0 || (command !== "build" && command !== "verify")) {
    throw new Error("Usage: prepared-electron-build.ts <build|verify>");
  }
  if (command === "build") {
    runProductionBuild();
    return;
  }
  verifyPreparedElectronBuild({ repositoryRoot, manifestPath: defaultManifestPath });
  process.stdout.write("Prepared Electron build verified.\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
