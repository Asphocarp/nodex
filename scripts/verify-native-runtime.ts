import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readNativeRuntimeManifest,
  type NativeRuntimeArchitecture,
} from "./native-runtime-manifest";

interface VerificationOptions {
  readonly appPath: string;
  readonly launchApp: boolean;
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

const smokeNativeRuntime = async (
  appPath: string,
  expectedCoreSha256: string,
): Promise<void> => {
  const directory = mkdtempSync("/tmp/ndx-pkg-");
  const environment = restrictedEnvironment(directory);
  const cli = join(appPath, "Contents/Resources/bin/nodex");
  const descriptor = join(environment.NODEX_HOME!, "run/core/core.json");
  try {
    chmodSync(directory, 0o700);
    mkdirSync(environment.TMPDIR!, { mode: 0o700 });
    const version = runWithEnvironment(cli, ["--version"], environment, "Run packaged nodex");
    if (!/^nodex \d+\.\d+\.\d+/mu.test(version.stdout)) {
      throw new Error(`Packaged nodex returned an invalid version: ${version.stdout.trim()}`);
    }
    const doctor = runWithEnvironment(cli, ["--json", "doctor"], environment, "Run packaged Core doctor");
    const envelope = JSON.parse(doctor.stdout) as { ok?: unknown };
    if (envelope.ok !== true) throw new Error("Packaged Core doctor did not return a successful envelope");
    const firstCore = readPackagedCoreIdentity(descriptor, expectedCoreSha256);
    const repeatedDoctor = runWithEnvironment(
      cli,
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
    const searchSentinel = "packaged-native-cli-ripgrep-sentinel";
    const searchBodyPath = join(directory, "search-smoke.nested.md");
    writeFileSync(searchBodyPath, `${searchSentinel}\n`, { encoding: "utf8", mode: 0o600 });
    const pageCreation = runWithEnvironment(
      cli,
      [
        "--json",
        "--project",
        "project:default",
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
      cli,
      ["--project", "project:default", "rg", searchSentinel, `@${pageId}`],
      environment,
      "Run packaged CLI ripgrep",
    );
    if (!search.stdout.includes(searchSentinel) || !search.stdout.includes(pageId)) {
      throw new Error("Packaged CLI ripgrep did not return the created Page");
    }
    const service = runWithEnvironment(
      cli,
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
    timeout: 30_000,
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
  const contentsPath = join(appPath, "Contents");
  const manifestPath = join(contentsPath, "Resources/bin/rust-core-runtime.json");
  const manifest = readNativeRuntimeManifest(manifestPath);
  if (manifest.targetArch !== options.targetArch) {
    throw new Error(`Native runtime manifest is ${manifest.targetArch}, expected ${options.targetArch}`);
  }
  const binaryPaths = manifest.binaries.map((binary) => {
    const binaryPath = join(contentsPath, ...binary.bundlePath.split("/"));
    assertRegularExecutable(binaryPath);
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
  await smokeNativeRuntime(appPath, coreManifest.sourceSha256);
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
  if (!appPath || (targetArch !== "arm64" && targetArch !== "x64")) {
    throw new Error(
      "usage: verify-native-runtime --app-path <Nodex.app> --target-arch arm64|x64 [--verify-signatures] [--require-developer-id] [--verify-notarization] [--launch-app]",
    );
  }
  const requireDeveloperId = arguments_.includes("--require-developer-id");
  const verifyNotarization = arguments_.includes("--verify-notarization");
  await verifyPackagedNativeRuntime({
    appPath,
    launchApp: arguments_.includes("--launch-app"),
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
