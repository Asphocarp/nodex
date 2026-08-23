import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readNativeRuntimeManifest,
  sha256File,
  type NativeRuntimeArchitecture,
} from "./native-runtime-manifest";
import { cleanupIsolatedCore } from "./isolated-core-cleanup";
import { verifyPackagedAgentSkills } from "./verify-packaged-agent-skills";
import { InitialProjectBootstrapService } from "../src/main/initial-project-bootstrap-service";
import { resolveInitialProjectJournalPath } from "../src/main/initial-project/initial-project-journal-store";
import { CoreClient } from "../src/main/core-client/core-client";
import {
  acquireIsolatedRunLease,
  ISOLATED_RUN_ID_ENV,
  readIsolatedRunClaim,
} from "../src/main/core-client/isolated-run-ownership";
import { createCoreProjectWorkspaceAdapter } from "../src/main/core-client/project-workspace-adapter";

export interface PackagedNativeRuntimeStructureOptions {
  readonly appPath: string;
  /** The human-facing CFBundleShortVersionString encoded in the app. */
  readonly expectedVersion: string;
  /** The monotonic Apple CFBundleVersion used for update ordering. */
  readonly expectedBuildVersion: string;
  readonly requireDeveloperId: boolean;
  readonly targetArch: NativeRuntimeArchitecture;
  readonly expectedUpdateChannel?: "disabled" | "stable" | "nightly";
  readonly verifyNotarization: boolean;
  readonly verifySignatures: boolean;
}

export interface PackagedNativeRuntimeSmokeOptions extends PackagedNativeRuntimeStructureOptions {
  readonly launchApp: boolean;
  readonly previousStoreFixturePath?: string;
}

export interface PackagedNativeRuntimeIdentity {
  readonly appPath: string;
  readonly coreSha256: string;
  readonly expectedVersion: string;
  readonly targetArch: NativeRuntimeArchitecture;
}

interface CommandResult {
  readonly stderr: string;
  readonly stdout: string;
}

const expectedFileArchitecture = (architecture: NativeRuntimeArchitecture): string =>
  architecture === "arm64" ? "arm64" : "x86_64";

const DEFAULT_PREVIOUS_STORE_FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../crates/nodex-core/tests/fixtures/store-v130.db",
);

const STORE_MIGRATION_BACKUP_NAME = /^v([1-9]\d*)-to-v([1-9]\d*)-([a-f0-9]{64})\.db$/u;
const STORE_FIXTURE_NAME = /^store-v([1-9]\d*)\.db$/u;

export const assertContentAddressedStoreMigrationBackup = (
  backupPath: string,
  expected: { readonly sourceRevision: number; readonly targetRevision: number },
): void => {
  const metadata = lstatSync(backupPath);
  const match = STORE_MIGRATION_BACKUP_NAME.exec(basename(backupPath));
  if (!metadata.isFile() || metadata.isSymbolicLink() || !match) {
    throw new Error("Packaged Store migration did not retain one content-addressed backup");
  }
  if (
    Number(match[1]) !== expected.sourceRevision ||
    Number(match[2]) !== expected.targetRevision ||
    expected.targetRevision <= expected.sourceRevision
  ) {
    throw new Error("Packaged Store migration backup transition does not match the runtime");
  }
  if (sha256File(backupPath) !== match[3]) {
    throw new Error("Packaged Store migration backup digest does not match its filename");
  }
};

const storeFixtureRevision = (fixturePath: string): number => {
  const revision = Number(STORE_FIXTURE_NAME.exec(basename(fixturePath))?.[1]);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error("Packaged Store migration fixture must use the canonical store-vN.db name");
  }
  return revision;
};

const currentStoreRevision = (descriptorPath: string): number => {
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as {
    readonly actual_store_format?: { readonly version?: unknown };
    readonly manifest?: { readonly store?: { readonly current?: { readonly version?: unknown } } };
  };
  const advertised = descriptor.manifest?.store?.current?.version;
  const actual = descriptor.actual_store_format?.version;
  if (!Number.isSafeInteger(advertised) || !Number.isSafeInteger(actual) || advertised !== actual) {
    throw new Error("Packaged Core published inconsistent Store revision evidence");
  }
  return actual as number;
};

const run = (command: string, arguments_: readonly string[], label: string): CommandResult => {
  const result = spawnSync(command, arguments_, { encoding: "utf8" });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with status ${result.status}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return { stderr: result.stderr, stdout: result.stdout };
};

const assertRegularExecutable = (filePath: string): void => {
  const metadata = lstatSync(filePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Native runtime entry must be a regular file: ${filePath}`);
  }
  if ((metadata.mode & 0o111) === 0) {
    throw new Error(`Native runtime entry is not executable: ${filePath}`);
  }
};

const assertMachO = (
  filePath: string,
  architecture: NativeRuntimeArchitecture,
  minimumMacOS: string,
): void => {
  assertMachOArchitecture(filePath, architecture);
  const loadCommands = run("otool", ["-l", filePath], `Inspect ${filePath} load commands`).stdout;
  if (
    !new RegExp(`LC_BUILD_VERSION[\\s\\S]*?minos ${minimumMacOS.replace(".", "\\.")}\\b`).test(
      loadCommands,
    )
  ) {
    throw new Error(`Native runtime minimum macOS mismatch for ${filePath}`);
  }
};

const assertMachOArchitecture = (
  filePath: string,
  architecture: NativeRuntimeArchitecture,
): void => {
  const description = run("file", ["-b", filePath], `Inspect ${filePath}`).stdout.trim();
  const expectedArchitecture = expectedFileArchitecture(architecture);
  if (!description.includes("Mach-O") || !description.includes(expectedArchitecture)) {
    throw new Error(`Native runtime architecture mismatch for ${filePath}: ${description}`);
  }
};

const signatureDetails = (
  artifactPath: string,
): { adhoc: boolean; teamIdentifier: string | null } => {
  run("codesign", ["--verify", "--strict", "--verbose=2", artifactPath], `Verify ${artifactPath}`);
  const display = run("codesign", ["-dv", "--verbose=4", artifactPath], `Inspect ${artifactPath}`);
  const output = `${display.stdout}\n${display.stderr}`;
  const team = /^TeamIdentifier=(.+)$/mu.exec(output)?.[1]?.trim();
  return {
    adhoc: /(?:^|,)adhoc(?:,|\))/mu.test(output) || /^Signature=adhoc$/mu.test(output),
    teamIdentifier: !team || team === "not set" ? null : team,
  };
};

const verifySignatures = (
  appPath: string,
  binaryPaths: readonly string[],
  requireDeveloperId: boolean,
): void => {
  const helperApp = join(appPath, "Contents/Helpers/Nodex Service.app");
  const appSignature = signatureDetails(appPath);
  const nestedSignatures = [...binaryPaths.map(signatureDetails), signatureDetails(helperApp)];
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "Verify app seal");
  if (!requireDeveloperId) return;
  if (appSignature.adhoc || !appSignature.teamIdentifier) {
    throw new Error("Packaged Nodex.app is not signed with a Developer ID identity");
  }
  for (const signature of nestedSignatures) {
    if (signature.adhoc || signature.teamIdentifier !== appSignature.teamIdentifier) {
      throw new Error("Native runtime signature is inconsistent with the enclosing Nodex.app");
    }
  }
};

const assertSymlinksStayInside = (rootPath: string, currentPath = rootPath): void => {
  const canonicalRoot = realpathSync(rootPath);
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const entryPath = join(currentPath, entry.name);
    const metadata = lstatSync(entryPath);
    if (metadata.isSymbolicLink()) {
      const target = readlinkSync(entryPath);
      const resolvedTarget = realpathSync(resolve(dirname(entryPath), target));
      const relativeTarget = relative(canonicalRoot, resolvedTarget);
      if (
        target.startsWith("/") ||
        relativeTarget === ".." ||
        relativeTarget.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
        resolve(canonicalRoot, relativeTarget) !== resolvedTarget
      ) {
        throw new Error(`Sparkle framework symlink escapes its root: ${entryPath}`);
      }
      continue;
    }
    if (metadata.isDirectory()) assertSymlinksStayInside(rootPath, entryPath);
  }
};

const verifySparkleRuntime = (
  appPath: string,
  options: PackagedNativeRuntimeStructureOptions,
): readonly string[] => {
  const contentsPath = join(appPath, "Contents");
  const resourcesPath = join(contentsPath, "Resources");
  const manifestPath = join(resourcesPath, "native/sparkle-runtime.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    readonly architecture?: unknown;
    readonly artifacts?: Record<
      string,
      { readonly path?: unknown; readonly sha256?: unknown; readonly size?: unknown }
    >;
    readonly buildChannel?: unknown;
    readonly feedUrls?: Record<string, unknown> | null;
    readonly minimumMacOS?: unknown;
    readonly publicKey?: unknown;
    readonly schemaVersion?: unknown;
    readonly sparkleVersion?: unknown;
  };
  const expectedPaths = {
    autoupdate: "Frameworks/Sparkle.framework/Versions/B/Autoupdate",
    bridge: "Resources/native/nodex-sparkle.node",
    frameworkExecutable: "Frameworks/Sparkle.framework/Versions/B/Sparkle",
    frameworkInfoPlist: "Frameworks/Sparkle.framework/Versions/B/Resources/Info.plist",
    updater: "Frameworks/Sparkle.framework/Versions/B/Updater.app/Contents/MacOS/Updater",
  };
  if (
    manifest.schemaVersion !== 3 ||
    manifest.architecture !== options.targetArch ||
    (manifest.buildChannel !== "disabled" &&
      manifest.buildChannel !== "stable" &&
      manifest.buildChannel !== "nightly") ||
    (options.expectedUpdateChannel && manifest.buildChannel !== options.expectedUpdateChannel) ||
    manifest.minimumMacOS !== "12.0" ||
    manifest.sparkleVersion !== "2.9.4" ||
    typeof manifest.publicKey !== "string" ||
    !manifest.artifacts
  ) {
    throw new Error("Packaged Sparkle runtime manifest is invalid.");
  }
  const expectedFeeds = {
    stable: `https://nodex.jyu.app/updates/stable/${options.targetArch}/appcast.xml`,
    nightly: `https://nodex.jyu.app/updates/nightly/${options.targetArch}/appcast.xml`,
  };
  if (
    (manifest.buildChannel === "disabled" && manifest.feedUrls !== null) ||
    (manifest.buildChannel !== "disabled" &&
      (manifest.feedUrls?.stable !== expectedFeeds.stable ||
        manifest.feedUrls?.nightly !== expectedFeeds.nightly))
  ) {
    throw new Error("Packaged Sparkle feed does not match its channel.");
  }
  for (const [name, relativePath] of Object.entries(expectedPaths)) {
    const identity = manifest.artifacts?.[name];
    const filePath = join(contentsPath, ...relativePath.split("/"));
    const metadata = lstatSync(filePath);
    if (
      identity?.path !== relativePath ||
      identity.sha256 !== sha256File(filePath) ||
      identity.size !== metadata.size ||
      metadata.isSymbolicLink() ||
      !metadata.isFile()
    ) {
      throw new Error(`Packaged Sparkle artifact identity mismatch: ${name}.`);
    }
  }
  const frameworkPath = join(contentsPath, "Frameworks/Sparkle.framework");
  assertSymlinksStayInside(frameworkPath);
  if (
    existsSync(join(frameworkPath, "Versions/B/XPCServices")) ||
    existsSync(join(frameworkPath, "XPCServices"))
  ) {
    throw new Error("Packaged non-sandboxed Sparkle framework must not contain XPC services.");
  }
  const bridgePath = join(resourcesPath, "native/nodex-sparkle.node");
  assertRegularExecutable(bridgePath);
  assertMachO(bridgePath, options.targetArch, "12.0");
  const linkage = run("otool", ["-L", bridgePath], "Inspect Sparkle bridge linkage").stdout;
  const loadCommands = run("otool", ["-l", bridgePath], "Inspect Sparkle bridge rpath").stdout;
  if (
    !linkage.includes("@rpath/Sparkle.framework/Versions/B/Sparkle") ||
    !loadCommands.includes("@loader_path/../../Frameworks")
  ) {
    throw new Error("Packaged Sparkle bridge linkage is invalid.");
  }
  for (const relativePath of [
    expectedPaths.frameworkExecutable,
    expectedPaths.autoupdate,
    expectedPaths.updater,
  ]) {
    const architectures = run(
      "/usr/bin/lipo",
      ["-archs", join(contentsPath, ...relativePath.split("/"))],
      "Inspect Sparkle universal binary",
    )
      .stdout.trim()
      .split(/\s+/u)
      .sort();
    if (JSON.stringify(architectures) !== JSON.stringify(["arm64", "x86_64"])) {
      throw new Error(`Packaged Sparkle framework binary is not universal: ${relativePath}.`);
    }
  }
  const appInfoPlist = join(contentsPath, "Info.plist");
  const readAppPlist = (key: string): string =>
    run(
      "/usr/bin/plutil",
      ["-extract", key, "raw", "-o", "-", appInfoPlist],
      `Read ${key}`,
    ).stdout.trim();
  if (
    readAppPlist("SUPublicEDKey") !== manifest.publicKey ||
    readAppPlist("SURequireSignedFeed") !== "true" ||
    readAppPlist("SUVerifyUpdateBeforeExtraction") !== "true"
  ) {
    throw new Error("Packaged Sparkle Info.plist security keys are invalid.");
  }
  const sparkleCodeObjects = [
    bridgePath,
    join(frameworkPath, "Versions/B/Autoupdate"),
    join(frameworkPath, "Versions/B/Updater.app"),
    frameworkPath,
  ];
  if (options.verifySignatures) {
    for (const codeObject of sparkleCodeObjects) {
      const entitlements = spawnSync("codesign", ["-d", "--entitlements", ":-", codeObject], {
        encoding: "utf8",
      });
      const output = `${entitlements.stdout ?? ""}\n${entitlements.stderr ?? ""}`;
      if (
        output.includes("com.apple.security.cs.allow-jit") ||
        output.includes("com.apple.security.cs.allow-unsigned-executable-memory")
      ) {
        throw new Error(`Sparkle code object carries Electron runtime entitlements: ${codeObject}`);
      }
    }
  }
  return sparkleCodeObjects;
};

const restrictedEnvironment = (home: string): NodeJS.ProcessEnv => ({
  CARGO_HOME: join(home, "unavailable-cargo-home"),
  HOME: home,
  NODEX_CORE_IDLE_TIMEOUT_MS: "2000",
  NODEX_HOME: join(home, "profile"),
  NODEX_LOG_CONSOLE: "false",
  NODEX_LOG_FILE: "true",
  PATH: "/usr/bin:/bin",
  RUSTUP_HOME: join(home, "unavailable-rustup-home"),
  TMPDIR: join(home, "tmp"),
});

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, durationMs));

const makeDirectoriesOwnerWritable = (directory: string): void => {
  const metadata = lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) return;
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory)) {
    makeDirectoriesOwnerWritable(join(directory, entry));
  }
};

export const removePrivateTemporaryDirectory = (directory: string): void => {
  if (!existsSync(directory)) return;
  makeDirectoriesOwnerWritable(directory);
  rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
};

export const assertLegacyPackagedRuntimePathsAbsent = (contentsPath: string): void => {
  const legacyPaths = [
    join(contentsPath, "Resources/agent-runtime"),
    join(contentsPath, "Resources/bin/rg"),
  ];
  for (const legacyPath of legacyPaths) {
    let exists = false;
    try {
      lstatSync(legacyPath);
      exists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (exists) {
      throw new Error(`Packaged runtime contains an obsolete duplicate path: ${legacyPath}`);
    }
  }
};

const waitForRuntimeExit = async (descriptor: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (existsSync(descriptor) && Date.now() < deadline) await delay(25);
  if (existsSync(descriptor)) {
    throw new Error("Packaged Core did not exit after smoke-test cleanup");
  }
};

interface PackagedCoreIdentity {
  readonly pid: number;
  readonly startNonce: string;
}

const readPackagedCoreIdentity = (
  descriptorPath: string,
  expectedArtifactSha256: string,
): PackagedCoreIdentity => {
  const value = JSON.parse(readFileSync(descriptorPath, "utf8")) as {
    readonly artifact?: { readonly sha256?: unknown };
    readonly manifest_digest?: unknown;
    readonly pid?: unknown;
    readonly start_nonce?: unknown;
  };
  if (!Number.isSafeInteger(value.pid) || typeof value.start_nonce !== "string") {
    throw new Error("Packaged Core published an invalid runtime generation identity");
  }
  if (value.artifact?.sha256 !== expectedArtifactSha256) {
    throw new Error("Packaged Core self identity does not match rust-core-runtime.json");
  }
  if (typeof value.manifest_digest !== "string" || !/^[a-f0-9]{64}$/u.test(value.manifest_digest)) {
    throw new Error("Packaged Core published an invalid compatibility manifest digest");
  }
  return { pid: value.pid as number, startNonce: value.start_nonce };
};

export const isPackagedAppReady = (options: {
  readonly descriptorPath: string;
  readonly expectedCoreSha256: string;
  readonly expectedHostPid: number;
  readonly nodexHome: string;
  readonly runId: string;
}): boolean => {
  const claim = readIsolatedRunClaim(options.nodexHome);
  if (!claim || claim.phase !== "ready") return false;
  if (claim.runId !== options.runId || claim.hostPid !== options.expectedHostPid) {
    throw new Error("Packaged Nodex.app readiness belongs to another host generation");
  }
  if (!existsSync(options.descriptorPath)) {
    throw new Error("Packaged Nodex.app became ready without a Core runtime descriptor");
  }
  readPackagedCoreIdentity(options.descriptorPath, options.expectedCoreSha256);
  return true;
};

export const selectPackagedSmokeProjectId = (
  projects: readonly { readonly id: string }[],
): string => {
  if (projects.length !== 1) {
    throw new Error(
      `Packaged CLI smoke expected one bootstrapped Project, found ${projects.length}`,
    );
  }
  const projectId = projects[0]?.id;
  if (
    typeof projectId !== "string" ||
    projectId.length === 0 ||
    projectId.length > 512 ||
    projectId.trim() !== projectId
  ) {
    throw new Error("Packaged CLI smoke bootstrap returned an invalid Project ID");
  }
  return projectId;
};

const bootstrapPackagedCliProject = async (
  environment: NodeJS.ProcessEnv,
  temporaryRoot: string,
): Promise<{
  readonly client: CoreClient;
  readonly projectId: string;
}> => {
  const nodexHome = environment.NODEX_HOME;
  if (!nodexHome) {
    throw new Error("Packaged CLI smoke environment omits NODEX_HOME");
  }
  const client = await CoreClient.connect({
    nodexHome,
    clientKind: "electron_host",
    buildId: "packaged-native-runtime-verification",
  });
  const projectWorkspace = createCoreProjectWorkspaceAdapter(client);
  const bootstrap = new InitialProjectBootstrapService({
    projectWorkspace,
    projectsDirectory: join(temporaryRoot, "projects"),
    journalPath: resolveInitialProjectJournalPath(nodexHome),
  });
  await bootstrap.ensureInitialProject({
    onProvisioned: async () => undefined,
  });
  return {
    client,
    projectId: selectPackagedSmokeProjectId(await projectWorkspace.listProjects()),
  };
};

export const shutdownPackagedCore = async (
  client: { shutdown(): Promise<{ readonly status: string }> },
  descriptor: string,
): Promise<void> => {
  const response = await client.shutdown();
  if (response.status !== "draining") {
    throw new Error(`Packaged Core rejected smoke-test shutdown with ${response.status}`);
  }
  await waitForRuntimeExit(descriptor);
};

const smokeNativeRuntime = async (
  appPath: string,
  expectedCoreSha256: string,
  expectedVersion: string,
): Promise<void> => {
  const directory = mkdtempSync("/tmp/ndx-pkg-");
  const environment = restrictedEnvironment(directory);
  const cli = join(appPath, "Contents/Resources/bin/nodex");
  const linkedCliDirectory = join(directory, "cli-bin");
  const linkedCli = join(linkedCliDirectory, "nodex");
  const descriptor = join(environment.NODEX_HOME!, "run/core/core.json");
  try {
    chmodSync(directory, 0o700);
    mkdirSync(environment.TMPDIR!, { mode: 0o700 });
    mkdirSync(linkedCliDirectory, { mode: 0o700 });
    symlinkSync(cli, linkedCli);
    const version = runWithEnvironment(
      linkedCli,
      ["--version"],
      environment,
      "Run packaged nodex through its installed symlink",
    );
    if (version.stdout.trim() !== `nodex ${expectedVersion}`) {
      throw new Error(
        `Packaged nodex version mismatch: ${version.stdout.trim()}, expected nodex ${expectedVersion}`,
      );
    }
    const doctor = runWithEnvironment(
      linkedCli,
      ["--json", "doctor"],
      environment,
      "Run packaged Core doctor through its installed symlink",
    );
    const envelope = JSON.parse(doctor.stdout) as { ok?: unknown };
    if (envelope.ok !== true)
      throw new Error("Packaged Core doctor did not return a successful envelope");
    const firstCore = readPackagedCoreIdentity(descriptor, expectedCoreSha256);
    const repeatedDoctor = runWithEnvironment(
      linkedCli,
      ["--json", "doctor"],
      environment,
      "Reuse packaged Core doctor",
    );
    if ((JSON.parse(repeatedDoctor.stdout) as { ok?: unknown }).ok !== true) {
      throw new Error("Repeated packaged Core doctor did not return a successful envelope");
    }
    const reusedCore = readPackagedCoreIdentity(descriptor, expectedCoreSha256);
    if (reusedCore.pid !== firstCore.pid || reusedCore.startNonce !== firstCore.startNonce) {
      throw new Error("Compatible packaged CLI selectors did not reuse one Core generation");
    }
    const bootstrap = await bootstrapPackagedCliProject(environment, directory);
    const searchSentinel = "packaged-native-cli-ripgrep-sentinel";
    const searchBodyPath = join(directory, "search-smoke.nested.md");
    writeFileSync(searchBodyPath, `${searchSentinel}\n`, { encoding: "utf8", mode: 0o600 });
    const pageCreation = runWithEnvironment(
      linkedCli,
      [
        "--json",
        "--project",
        bootstrap.projectId,
        "page",
        "create",
        "--parent",
        "library",
        "--title",
        "Packaged CLI search smoke",
        "--file",
        searchBodyPath,
        "--idempotency-key",
        "packaged-native-runtime-search-smoke",
      ],
      environment,
      "Create packaged CLI search Page",
    );
    const pageEnvelope = JSON.parse(pageCreation.stdout) as {
      ok?: unknown;
      result?: { page_id?: unknown };
    };
    const pageId = pageEnvelope.result?.page_id;
    if (pageEnvelope.ok !== true || typeof pageId !== "string" || pageId.length === 0) {
      throw new Error("Packaged CLI search Page creation returned an invalid envelope");
    }
    const search = runWithEnvironment(
      linkedCli,
      ["--project", bootstrap.projectId, "rg", searchSentinel, `@${pageId}`],
      environment,
      "Run packaged CLI ripgrep",
    );
    if (!search.stdout.includes(searchSentinel) || !search.stdout.includes(pageId)) {
      throw new Error("Packaged CLI ripgrep did not return the created Page");
    }
    const service = runWithEnvironment(
      linkedCli,
      ["--json", "service", "status"],
      environment,
      "Run packaged ServiceManagement status",
    );
    const serviceEnvelope = JSON.parse(service.stdout) as { ok?: unknown };
    if (serviceEnvelope.ok !== true) {
      throw new Error("Packaged ServiceManagement status did not return a successful envelope");
    }
    await shutdownPackagedCore(bootstrap.client, descriptor);
  } finally {
    if (!existsSync(descriptor)) {
      removePrivateTemporaryDirectory(directory);
    }
  }
};

const smokePreviousStoreMigration = async (
  appPath: string,
  previousStoreFixturePath: string,
): Promise<void> => {
  const sourceRevision = storeFixtureRevision(previousStoreFixturePath);
  const directory = mkdtempSync("/tmp/ndx-store-migration-pkg-");
  const environment = restrictedEnvironment(directory);
  const profile = environment.NODEX_HOME!;
  const descriptor = join(profile, "run/core/core.json");
  const cli = join(appPath, "Contents/Resources/bin/nodex");
  const linkedCliDirectory = join(directory, "cli-bin");
  const linkedCli = join(linkedCliDirectory, "nodex");
  try {
    chmodSync(directory, 0o700);
    mkdirSync(environment.TMPDIR!, { mode: 0o700 });
    mkdirSync(profile, { mode: 0o700 });
    mkdirSync(linkedCliDirectory, { mode: 0o700 });
    copyFileSync(previousStoreFixturePath, join(profile, "nodex.db"));
    symlinkSync(cli, linkedCli);

    const doctor = runWithEnvironment(
      linkedCli,
      ["--json", "doctor"],
      environment,
      `Migrate the v${sourceRevision} Store baseline through the packaged CLI symlink`,
    );
    if ((JSON.parse(doctor.stdout) as { ok?: unknown }).ok !== true) {
      throw new Error("Migrated packaged Core doctor did not return a successful envelope");
    }
    const backupRoot = join(profile, "backups/core-migrations");
    const backups = readdirSync(backupRoot).filter((entry) => !entry.startsWith("."));
    if (backups.length !== 1) {
      throw new Error("Packaged Store migration did not retain one content-addressed backup");
    }
    assertContentAddressedStoreMigrationBackup(join(backupRoot, backups[0]!), {
      sourceRevision,
      targetRevision: currentStoreRevision(descriptor),
    });
    const reopened = runWithEnvironment(
      linkedCli,
      ["--json", "doctor"],
      environment,
      "Reopen the migrated packaged Store",
    );
    if ((JSON.parse(reopened.stdout) as { ok?: unknown }).ok !== true) {
      throw new Error("Reopened packaged Core doctor did not return a successful envelope");
    }
    if (readdirSync(backupRoot).filter((entry) => !entry.startsWith(".")).length !== 1) {
      throw new Error("Packaged Store migration repeated its backup after reopen");
    }
    await waitForRuntimeExit(descriptor);
  } finally {
    if (!existsSync(descriptor)) {
      removePrivateTemporaryDirectory(directory);
    }
  }
};

const smokeBrowserProfileHelper = (appPath: string): void => {
  const directory = mkdtempSync("/tmp/ndx-browser-profile-helper-");
  try {
    const helper = join(appPath, "Contents/Resources/bin/nodex-browser-profile-helper");
    const result = spawnSync(helper, [], {
      cwd: directory,
      encoding: "utf8",
      env: restrictedEnvironment(directory),
      input: JSON.stringify({
        schemaVersion: 1,
        operation: "read-profile",
        source: "chrome",
        profilePath: join(directory, "missing-profile"),
        includeCookies: true,
        includePasswords: false,
        cookieDomainAllowlist: [],
      }),
      timeout: 5_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Packaged Browser Profile helper failed to start: ${
          result.error?.message ?? result.stderr.trim()
        }`,
      );
    }
    const response = JSON.parse(result.stdout) as {
      readonly errorCode?: unknown;
      readonly ok?: unknown;
      readonly schemaVersion?: unknown;
    };
    if (
      response.schemaVersion !== 1 ||
      response.ok !== false ||
      response.errorCode !== "data_unavailable"
    ) {
      throw new Error("Packaged Browser Profile helper returned an invalid envelope");
    }
  } finally {
    removePrivateTemporaryDirectory(directory);
  }
};

const runWithEnvironment = (
  command: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  label: string,
): CommandResult => {
  const result = spawnSync(command, arguments_, {
    cwd: environment.HOME,
    encoding: "utf8",
    env: environment,
    timeout: 120_000,
  });
  if (result.error) throw new Error(`${label} could not complete: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with status ${result.status}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return { stderr: result.stderr, stdout: result.stdout };
};

const PACKAGED_APP_STARTUP_TIMEOUT_MS = 60_000;
const PACKAGED_APP_TERMINATION_TIMEOUT_MS = 10_000;
const PACKAGED_APP_KILL_TIMEOUT_MS = 5_000;
const MAX_PACKAGED_APP_DIAGNOSTIC_CHARS = 32_768;

interface CapturedProcessOutput {
  stderr: string;
  stdout: string;
}

const captureProcessOutput = (child: ChildProcess): CapturedProcessOutput => {
  const output: CapturedProcessOutput = { stderr: "", stdout: "" };
  const append = (key: keyof CapturedProcessOutput, chunk: Buffer | string): void => {
    output[key] = `${output[key]}${String(chunk)}`.slice(-MAX_PACKAGED_APP_DIAGNOSTIC_CHARS);
  };
  child.stdout?.on("data", (chunk: Buffer | string) => append("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer | string) => append("stderr", chunk));
  return output;
};

const readPackagedAppRuntimeLogs = (nodexHome: string): string => {
  const logDirectory = join(nodexHome, "logs");
  if (!existsSync(logDirectory)) return "";
  try {
    return readdirSync(logDirectory)
      .filter((entry) => entry.endsWith(".log"))
      .sort()
      .slice(-4)
      .map((entry) => `== ${entry} ==\n${readFileSync(join(logDirectory, entry), "utf8")}`)
      .join("\n")
      .slice(-MAX_PACKAGED_APP_DIAGNOSTIC_CHARS);
  } catch (error) {
    return `Unable to read packaged app runtime logs: ${String(error)}`;
  }
};

const waitForChildExit = async (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolvePromise) => {
    const onClose = (): void => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolvePromise(false);
    }, timeoutMs);
    child.once("close", onClose);
  });
};

const signalProcessGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    child.kill(signal);
  }
};

const stopPackagedApp = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalProcessGroup(child, "SIGTERM");
  if (await waitForChildExit(child, PACKAGED_APP_TERMINATION_TIMEOUT_MS)) return;
  signalProcessGroup(child, "SIGKILL");
  if (await waitForChildExit(child, PACKAGED_APP_KILL_TIMEOUT_MS)) return;
  throw new Error("Packaged Nodex.app process group did not exit after SIGKILL");
};

const waitForPackagedAppReadiness = async (options: {
  readonly child: ChildProcess;
  readonly descriptorPath: string;
  readonly expectedCoreSha256: string;
  readonly nodexHome: string;
  readonly runId: string;
}): Promise<void> => {
  const spawnErrors: Error[] = [];
  const onSpawnError = (error: Error): void => {
    spawnErrors.push(error);
  };
  options.child.once("error", onSpawnError);
  try {
    const deadline = Date.now() + PACKAGED_APP_STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const spawnError = spawnErrors[0];
      if (spawnError) {
        throw new Error(`Packaged Nodex.app could not start: ${spawnError.message}`, {
          cause: spawnError,
        });
      }
      if (options.child.exitCode !== null || options.child.signalCode !== null) {
        throw new Error(
          "Packaged Nodex.app exited during startup " +
            `(code ${String(options.child.exitCode)}, signal ${String(options.child.signalCode)})`,
        );
      }
      if (
        options.child.pid &&
        isPackagedAppReady({
          descriptorPath: options.descriptorPath,
          expectedCoreSha256: options.expectedCoreSha256,
          expectedHostPid: options.child.pid,
          nodexHome: options.nodexHome,
          runId: options.runId,
        })
      ) {
        return;
      }
      await delay(50);
    }
    const phase = readIsolatedRunClaim(options.nodexHome)?.phase ?? "unclaimed";
    throw new Error(
      `Packaged Nodex.app did not become ready within ${PACKAGED_APP_STARTUP_TIMEOUT_MS}ms ` +
        `(isolated host phase: ${phase})`,
    );
  } finally {
    options.child.off("error", onSpawnError);
  }
};

const launchAppSmoke = async (appPath: string, expectedCoreSha256: string): Promise<void> => {
  const directory = mkdtempSync("/tmp/ndx-app-");
  const userData = join(directory, "electron-user-data");
  const environment = restrictedEnvironment(directory);
  const executable = join(appPath, "Contents/MacOS/Nodex");
  const nodexHome = environment.NODEX_HOME!;
  const descriptor = join(nodexHome, "run/core/core.json");
  const runId = randomUUID();
  mkdirSync(environment.TMPDIR!, { mode: 0o700 });
  mkdirSync(nodexHome, { mode: 0o700 });
  const lease = acquireIsolatedRunLease({ nodexHome, runId, supervisorPid: process.pid });
  const child = spawn(executable, [`--user-data-dir=${userData}`], {
    cwd: directory,
    detached: true,
    env: { ...environment, [ISOLATED_RUN_ID_ENV]: runId },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = captureProcessOutput(child);
  let startupError: unknown = null;
  const cleanupErrors: unknown[] = [];
  try {
    await waitForPackagedAppReadiness({
      child,
      descriptorPath: descriptor,
      expectedCoreSha256,
      nodexHome,
      runId,
    });
  } catch (error) {
    startupError = error;
  }

  let applicationExited = false;
  try {
    await stopPackagedApp(child);
    applicationExited = true;
  } catch (error) {
    cleanupErrors.push(error);
  }

  const runtimeLogs = readPackagedAppRuntimeLogs(nodexHome);
  let safeToRemove = false;
  if (applicationExited) {
    const coreCleanup = await cleanupIsolatedCore({ lease, nodexHome, runId });
    safeToRemove = coreCleanup.safeToDeleteRunRoot;
    if (!safeToRemove) {
      cleanupErrors.push(
        new Error(
          `Packaged Core cleanup ended with ${coreCleanup.status}: ` +
            (coreCleanup.reason ?? "no reason reported"),
        ),
      );
    }
  }

  if (safeToRemove) {
    try {
      removePrivateTemporaryDirectory(directory);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (startupError || cleanupErrors.length > 0) {
    const diagnostics = [
      startupError instanceof Error ? (startupError.stack ?? startupError.message) : startupError,
      ...cleanupErrors.map((error) => `Cleanup error: ${String(error)}`),
      output.stdout ? `== stdout ==\n${output.stdout}` : "",
      output.stderr ? `== stderr ==\n${output.stderr}` : "",
      runtimeLogs,
      existsSync(directory) ? `Preserved failed packaged smoke Profile: ${directory}` : "",
    ].filter((section): section is string => typeof section === "string" && section.length > 0);
    throw new Error(diagnostics.join("\n\n"), {
      cause: startupError ?? cleanupErrors[0],
    });
  }
};

export function verifyPackagedNativeRuntimeStructure(
  options: PackagedNativeRuntimeStructureOptions,
): PackagedNativeRuntimeIdentity {
  const appPath = resolve(options.appPath);
  verifyPackagedAgentSkills({ appPath });
  const contentsPath = join(appPath, "Contents");
  const manifestPath = join(contentsPath, "Resources/bin/rust-core-runtime.json");
  const manifest = readNativeRuntimeManifest(manifestPath);
  const expectedVersion = options.expectedVersion;
  if (manifest.productVersion !== expectedVersion) {
    throw new Error(
      `Native runtime product version is ${manifest.productVersion}, expected ${expectedVersion}`,
    );
  }
  const infoPlist = join(contentsPath, "Info.plist");
  const appVersion = run(
    "/usr/bin/plutil",
    ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPlist],
    "Read packaged app version",
  ).stdout.trim();
  if (appVersion !== expectedVersion) {
    throw new Error(`Packaged app version is ${appVersion}, expected ${expectedVersion}`);
  }
  const bundleVersion = run(
    "/usr/bin/plutil",
    ["-extract", "CFBundleVersion", "raw", "-o", "-", infoPlist],
    "Read packaged app bundle version",
  ).stdout.trim();
  if (bundleVersion !== options.expectedBuildVersion) {
    throw new Error(
      `Packaged app bundle version is ${bundleVersion}, expected build version ${options.expectedBuildVersion}`,
    );
  }
  if (manifest.targetArch !== options.targetArch) {
    throw new Error(
      `Native runtime manifest is ${manifest.targetArch}, expected ${options.targetArch}`,
    );
  }
  const binaryPaths = manifest.binaries.map((binary) => {
    const binaryPath = join(contentsPath, ...binary.bundlePath.split("/"));
    assertRegularExecutable(binaryPath);
    const metadata = statSync(binaryPath);
    if (metadata.size !== binary.sourceSize || sha256File(binaryPath) !== binary.sourceSha256) {
      throw new Error(`Native runtime manifest identity mismatch for ${binary.name}`);
    }
    assertMachO(binaryPath, options.targetArch, manifest.minimumMacOS);
    return binaryPath;
  });
  const cliRipgrep = join(contentsPath, "Resources/codex-path/rg");
  assertRegularExecutable(cliRipgrep);
  assertMachOArchitecture(cliRipgrep, options.targetArch);
  binaryPaths.push(cliRipgrep);
  binaryPaths.push(...verifySparkleRuntime(appPath, options));
  assertLegacyPackagedRuntimePathsAbsent(contentsPath);
  const resourcesService = join(contentsPath, "Resources/bin/nodex-service");
  if (existsSync(resourcesService)) {
    throw new Error("ServiceManagement adapter must only exist inside its nested helper app");
  }
  const helperInfo = join(contentsPath, "Helpers/Nodex Service.app/Contents/Info.plist");
  const helperLaunchAgent = join(
    contentsPath,
    "Helpers/Nodex Service.app/Contents/Library/LaunchAgents/app.jyu.nodex.background-service.core.plist",
  );
  if (!statSync(helperInfo).isFile() || !statSync(helperLaunchAgent).isFile()) {
    throw new Error("Packaged ServiceManagement helper bundle is incomplete");
  }
  if (options.verifySignatures) {
    verifySignatures(appPath, binaryPaths, options.requireDeveloperId);
  }
  if (options.verifyNotarization) {
    run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath], "Assess notarization");
    run("xcrun", ["stapler", "validate", appPath], "Validate notarization ticket");
  }
  const coreManifest = manifest.binaries.find(({ name }) => name === "nodex-core");
  if (!coreManifest) throw new Error("Native runtime manifest omits nodex-core");
  process.stdout.write(`Verified packaged native runtime structure ${options.targetArch}\n`);
  return {
    appPath,
    coreSha256: coreManifest.sourceSha256,
    expectedVersion,
    targetArch: options.targetArch,
  };
}

export async function verifyPackagedNativeRuntimeSmoke(
  options: PackagedNativeRuntimeSmokeOptions,
): Promise<void> {
  const identity = verifyPackagedNativeRuntimeStructure(options);
  await smokeNativeRuntime(identity.appPath, identity.coreSha256, identity.expectedVersion);
  await smokePreviousStoreMigration(
    identity.appPath,
    resolve(options.previousStoreFixturePath ?? DEFAULT_PREVIOUS_STORE_FIXTURE),
  );
  smokeBrowserProfileHelper(identity.appPath);
  if (options.launchApp) await launchAppSmoke(identity.appPath, identity.coreSha256);
  process.stdout.write(`Verified packaged native runtime smoke ${identity.targetArch}\n`);
}

const readOption = (arguments_: readonly string[], option: string): string | null => {
  const index = arguments_.indexOf(option);
  if (index < 0) return null;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
};

const main = async (): Promise<void> => {
  const arguments_ = process.argv.slice(2);
  const appPath = readOption(arguments_, "--app-path");
  const targetArch = readOption(arguments_, "--target-arch");
  const expectedVersion = readOption(arguments_, "--expected-version");
  if (!appPath || !expectedVersion || (targetArch !== "arm64" && targetArch !== "x64")) {
    throw new Error(
      "usage: verify-native-runtime --app-path <Nodex.app> --target-arch arm64|x64 " +
        "--expected-version <semver> [--expected-build-version <build>] " +
        "[--previous-store-fixture <store-v130.db>] [--verify-signatures] " +
        "[--require-developer-id] [--verify-notarization] [--launch-app] " +
        "[--expected-update-channel disabled|stable|nightly]",
    );
  }
  const requireDeveloperId = arguments_.includes("--require-developer-id");
  const verifyNotarization = arguments_.includes("--verify-notarization");
  const expectedUpdateChannel = readOption(arguments_, "--expected-update-channel");
  const expectedBuildVersion =
    readOption(arguments_, "--expected-build-version") ?? expectedVersion;
  if (
    expectedUpdateChannel !== null &&
    expectedUpdateChannel !== "disabled" &&
    expectedUpdateChannel !== "stable" &&
    expectedUpdateChannel !== "nightly"
  ) {
    throw new Error("--expected-update-channel must be disabled, stable, or nightly");
  }
  await verifyPackagedNativeRuntimeSmoke({
    appPath,
    expectedBuildVersion,
    expectedVersion,
    launchApp: arguments_.includes("--launch-app"),
    previousStoreFixturePath: readOption(arguments_, "--previous-store-fixture") ?? undefined,
    requireDeveloperId,
    targetArch,
    expectedUpdateChannel: expectedUpdateChannel ?? undefined,
    verifyNotarization,
    verifySignatures:
      arguments_.includes("--verify-signatures") || requireDeveloperId || verifyNotarization,
  });
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
