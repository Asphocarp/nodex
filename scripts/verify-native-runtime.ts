import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readNativeRuntimeManifest,
  sha256File,
  type NativeRuntimeArchitecture,
} from "./native-runtime-manifest";
import { verifyPackagedAgentSkills } from "./verify-packaged-agent-skills";
import { InitialProjectBootstrapService } from "../src/main/initial-project-bootstrap-service";
import { resolveInitialProjectJournalPath } from "../src/main/initial-project/initial-project-journal-store";
import { CoreClient } from "../src/main/core-client/core-client";
import { createCoreProjectWorkspaceAdapter } from "../src/main/core-client/project-workspace-adapter";

export interface VerificationOptions {
  readonly appPath: string;
  readonly expectedVersion: string;
  readonly launchApp: boolean;
  readonly legacyProfileFixturePath?: string;
  readonly requireDeveloperId: boolean;
  readonly targetArch: NativeRuntimeArchitecture;
  readonly verifyNotarization: boolean;
  readonly verifySignatures: boolean;
}

interface CommandResult {
  readonly stderr: string;
  readonly stdout: string;
}

const expectedFileArchitecture = (architecture: NativeRuntimeArchitecture): string =>
  architecture === "arm64" ? "arm64" : "x86_64";

const DEFAULT_LEGACY_PROFILE_FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../crates/nodex-core/tests/fixtures/legacy-profiles/v57-early.db",
);

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
  if (!new RegExp(`LC_BUILD_VERSION[\\s\\S]*?minos ${minimumMacOS.replace(".", "\\.")}\\b`).test(loadCommands)) {
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

const signatureDetails = (artifactPath: string): { adhoc: boolean; teamIdentifier: string | null } => {
  run("codesign", ["--verify", "--strict", "--verbose=2", artifactPath], `Verify ${artifactPath}`);
  const display = run("codesign", ["-dv", "--verbose=4", artifactPath], `Inspect ${artifactPath}`);
  const output = `${display.stdout}\n${display.stderr}`;
  const team = /^TeamIdentifier=(.+)$/mu.exec(output)?.[1]?.trim();
  return {
    adhoc: /(?:^|,)adhoc(?:,|\))/mu.test(output) || /^Signature=adhoc$/mu.test(output),
    teamIdentifier: !team || team === "not set" ? null : team,
  };
};

const verifySignatures = (appPath: string, binaryPaths: readonly string[], requireDeveloperId: boolean): void => {
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

const restrictedEnvironment = (home: string): NodeJS.ProcessEnv => ({
  CARGO_HOME: join(home, "unavailable-cargo-home"),
  HOME: home,
  NODEX_CORE_IDLE_TIMEOUT_MS: "2000",
  NODEX_HOME: join(home, "profile"),
  NODEX_LOG_CONSOLE: "false",
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
    throw new Error("Packaged Core did not idle-exit after its smoke-test client disconnected");
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
  if (typeof value.manifest_digest !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.manifest_digest)) {
    throw new Error("Packaged Core published an invalid compatibility manifest digest");
  }
  return { pid: value.pid as number, startNonce: value.start_nonce };
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
    typeof projectId !== "string"
    || projectId.length === 0
    || projectId.length > 512
    || projectId.trim() !== projectId
  ) {
    throw new Error("Packaged CLI smoke bootstrap returned an invalid Project ID");
  }
  return projectId;
};

const bootstrapPackagedCliProject = async (
  environment: NodeJS.ProcessEnv,
  temporaryRoot: string,
): Promise<string> => {
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
  return selectPackagedSmokeProjectId(await projectWorkspace.listProjects());
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
    if (envelope.ok !== true) throw new Error("Packaged Core doctor did not return a successful envelope");
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
    const projectId = await bootstrapPackagedCliProject(environment, directory);
    const searchSentinel = "packaged-native-cli-ripgrep-sentinel";
    const searchBodyPath = join(directory, "search-smoke.nested.md");
    writeFileSync(searchBodyPath, `${searchSentinel}\n`, { encoding: "utf8", mode: 0o600 });
    const pageCreation = runWithEnvironment(
      linkedCli,
      [
        "--json",
        "--project",
        projectId,
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
      ["--project", projectId, "rg", searchSentinel, `@${pageId}`],
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
    await waitForRuntimeExit(descriptor);
  } finally {
    if (!existsSync(descriptor)) {
      removePrivateTemporaryDirectory(directory);
    }
  }
};

const smokeLegacyProfileMigration = async (
  appPath: string,
  legacyProfileFixturePath: string,
): Promise<void> => {
  const directory = mkdtempSync("/tmp/ndx-legacy-pkg-");
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
    copyFileSync(legacyProfileFixturePath, join(profile, "nodex.db"));
    symlinkSync(cli, linkedCli);

    const doctor = runWithEnvironment(
      linkedCli,
      ["--json", "doctor"],
      environment,
      "Migrate an early v57 Profile through the packaged CLI symlink",
    );
    if ((JSON.parse(doctor.stdout) as { ok?: unknown }).ok !== true) {
      throw new Error("Migrated packaged Core doctor did not return a successful envelope");
    }
    const backupRoot = join(profile, "backups/core-migrations");
    const backups = readdirSync(backupRoot)
      .filter((entry) => !entry.startsWith("."))
      .map((entry) => join(backupRoot, entry))
      .filter((entry) => statSync(entry).isDirectory());
    if (
      backups.length !== 1
      || !statSync(join(backups[0]!, "nodex.db")).isFile()
    ) {
      throw new Error("Packaged legacy migration did not retain one source database backup");
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
    const helper = join(
      appPath,
      "Contents/Resources/bin/nodex-browser-profile-helper",
    );
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
      response.schemaVersion !== 1
      || response.ok !== false
      || response.errorCode !== "data_unavailable"
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
    throw new Error(`${label} failed with status ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  return { stderr: result.stderr, stdout: result.stdout };
};

const launchAppSmoke = async (appPath: string): Promise<void> => {
  const directory = mkdtempSync("/tmp/ndx-app-");
  const userData = join(directory, "electron-user-data");
  const environment = restrictedEnvironment(directory);
  const executable = join(appPath, "Contents/MacOS/Nodex");
  const descriptor = join(environment.NODEX_HOME!, "run/core/core.json");
  mkdirSync(environment.TMPDIR!, { mode: 0o700 });
  const child = spawn(executable, [`--user-data-dir=${userData}`], {
    cwd: directory,
    env: environment,
    stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 5_000;
    while (child.exitCode === null && Date.now() < deadline) {
      await delay(50);
    }
    if (child.exitCode !== null) {
      throw new Error(`Packaged Nodex.app exited during startup with status ${child.exitCode}`);
    }
    if (existsSync(descriptor)) {
      const runtime = JSON.parse(readFileSync(descriptor, "utf8")) as { pid?: unknown };
      if (!Number.isSafeInteger(runtime.pid)) {
        throw new Error("Packaged Nodex.app published an invalid Core runtime descriptor");
      }
    }
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise<void>((resolvePromise) => {
      if (child.exitCode !== null) return resolvePromise();
      child.once("exit", () => resolvePromise());
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 5_000);
    });
    await waitForRuntimeExit(descriptor);
    removePrivateTemporaryDirectory(directory);
  }
};

export async function verifyPackagedNativeRuntime(options: VerificationOptions): Promise<void> {
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
  if (bundleVersion !== expectedVersion) {
    throw new Error(`Packaged app bundle version is ${bundleVersion}, expected ${expectedVersion}`);
  }
  if (manifest.targetArch !== options.targetArch) {
    throw new Error(`Native runtime manifest is ${manifest.targetArch}, expected ${options.targetArch}`);
  }
  const binaryPaths = manifest.binaries.map((binary) => {
    const binaryPath = join(contentsPath, ...binary.bundlePath.split("/"));
    assertRegularExecutable(binaryPath);
    const metadata = statSync(binaryPath);
    if (
      metadata.size !== binary.sourceSize
      || sha256File(binaryPath) !== binary.sourceSha256
    ) {
      throw new Error(`Native runtime manifest identity mismatch for ${binary.name}`);
    }
    assertMachO(binaryPath, options.targetArch, manifest.minimumMacOS);
    return binaryPath;
  });
  const cliRipgrep = join(contentsPath, "Resources/codex-path/rg");
  assertRegularExecutable(cliRipgrep);
  assertMachOArchitecture(cliRipgrep, options.targetArch);
  binaryPaths.push(cliRipgrep);
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
  await smokeNativeRuntime(appPath, coreManifest.sourceSha256, expectedVersion);
  await smokeLegacyProfileMigration(
    appPath,
    resolve(options.legacyProfileFixturePath ?? DEFAULT_LEGACY_PROFILE_FIXTURE),
  );
  smokeBrowserProfileHelper(appPath);
  if (options.launchApp) await launchAppSmoke(appPath);
  process.stdout.write(`Verified packaged native runtime ${options.targetArch}\n`);
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
      "usage: verify-native-runtime --app-path <Nodex.app> --target-arch arm64|x64 "
      + "--expected-version <semver> [--legacy-profile-fixture <legacy.db>] [--verify-signatures] "
      + "[--require-developer-id] [--verify-notarization] [--launch-app]",
    );
  }
  const requireDeveloperId = arguments_.includes("--require-developer-id");
  const verifyNotarization = arguments_.includes("--verify-notarization");
  await verifyPackagedNativeRuntime({
    appPath,
    expectedVersion,
    launchApp: arguments_.includes("--launch-app"),
    legacyProfileFixturePath:
      readOption(arguments_, "--legacy-profile-fixture") ?? undefined,
    requireDeveloperId,
    targetArch,
    verifyNotarization,
    verifySignatures: arguments_.includes("--verify-signatures")
      || requireDeveloperId
      || verifyNotarization,
  });
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
