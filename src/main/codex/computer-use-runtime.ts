import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { BrowserUsePeerAuthorizationMode } from "../../shared/browser-use-host-capability";
import { BrowserUseNativePipeServer } from "../browser-use/browser-use-native-pipe-server";
import { createBrowserUsePeerAuthorizer } from "../browser-use/browser-use-peer-authorizer";
import { isMacOSVersionAtLeast, loadSkyNativeAddon, type SkyNativeAddon } from "../sky-native";
import type { BrowserRuntimeAvailability } from "./browser-runtime-bundle";
import {
  ComputerUseRuntimeConfigWriter,
  type ComputerUseRuntimeConfigInput,
  type ComputerUseRuntimeConfigWriteInput,
} from "./computer-use-runtime-config";

const execFileAsync = promisify(execFile);
const COMPUTER_USE_APP_NAME = "Codex Computer Use.app";
const COMPUTER_USE_SERVICE_RELATIVE_PATH = path.join("Contents", "MacOS", "SkyComputerUseService");
const MATERIALIZATION_KEY_FILENAME = ".materialization-key";

type ComputerUseRuntimeUnavailableReason =
  | "architecture-unsupported"
  | "helper-invalid"
  | "helper-materialization-failed"
  | "host-services-failed"
  | "macos-version-unsupported"
  | "native-addon-unavailable"
  | "platform-unsupported"
  | "runtime-unavailable";

export type ComputerUseRuntimeResult =
  | {
      appPath: string;
      hostServicesPipePath: string;
      serviceExecutablePath: string;
      status: "available";
    }
  | {
      message: string;
      reason: ComputerUseRuntimeUnavailableReason;
      status: "unavailable";
    };

type ComputerUseAppVerifier = (input: {
  appPath: string;
  bundleIdentifier: string;
  serviceExecutablePath: string;
  signingTeamId: string;
}) => Promise<void>;

type ComputerUseAppMaterializerOptions = {
  bundleIdentifier: string;
  copyApp?: (sourcePath: string, targetPath: string) => Promise<void>;
  desktopBuild: string;
  runtimeStateHome: string;
  signingTeamId: string;
  sourceAppPath: string;
  verifyApp?: ComputerUseAppVerifier;
};

function boundedMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_048);
}

function canonicalExecutablePath(executablePath: string): string {
  try {
    return realpathSync.native(executablePath);
  } catch {
    return path.resolve(executablePath);
  }
}

async function defaultCopyApp(sourcePath: string, targetPath: string): Promise<void> {
  await execFileAsync("/usr/bin/ditto", ["--noqtn", sourcePath, targetPath]);
}

async function readBundleIdentifier(appPath: string): Promise<string> {
  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    infoPlist,
  ]);
  return stdout.trim();
}

async function readSigningTeamId(codePath: string): Promise<string | null> {
  const { stderr, stdout } = await execFileAsync("/usr/bin/codesign", [
    "-dv",
    "--verbose=4",
    codePath,
  ]);
  return /^TeamIdentifier=(.+)$/mu.exec(`${stdout}\n${stderr}`)?.[1]?.trim() ?? null;
}

async function defaultVerifyApp(input: {
  appPath: string;
  bundleIdentifier: string;
  serviceExecutablePath: string;
  signingTeamId: string;
}): Promise<void> {
  await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", input.appPath]);
  if ((await readBundleIdentifier(input.appPath)) !== input.bundleIdentifier) {
    throw new Error("Computer Use helper bundle identifier is invalid");
  }
  if ((await readSigningTeamId(input.serviceExecutablePath)) !== input.signingTeamId) {
    throw new Error("Computer Use helper signing team is invalid");
  }
  const stats = await fs.lstat(input.serviceExecutablePath);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o111) === 0) {
    throw new Error("Computer Use service executable is invalid");
  }
}

async function moveDirectoryIntoPlace(
  stagingPath: string,
  targetPath: string,
): Promise<string | null> {
  const previousPath = `${targetPath}.previous-${randomUUID()}`;
  let movedPrevious = false;
  try {
    await fs.rename(targetPath, previousPath);
    movedPrevious = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await fs.rename(stagingPath, targetPath);
  } catch (error) {
    if (movedPrevious) await fs.rename(previousPath, targetPath);
    throw error;
  }
  return movedPrevious ? previousPath : null;
}

export class ComputerUseAppMaterializer {
  private readonly copyApp: (sourcePath: string, targetPath: string) => Promise<void>;
  private readonly options: ComputerUseAppMaterializerOptions;
  private readonly verifyApp: ComputerUseAppVerifier;

  constructor(options: ComputerUseAppMaterializerOptions) {
    this.options = options;
    this.copyApp = options.copyApp ?? defaultCopyApp;
    this.verifyApp = options.verifyApp ?? defaultVerifyApp;
  }

  async materialize(): Promise<{
    appPath: string;
    serviceExecutablePath: string;
  }> {
    const parentPath = path.join(path.resolve(this.options.runtimeStateHome), "computer-use");
    const appPath = path.join(parentPath, COMPUTER_USE_APP_NAME);
    const serviceExecutablePath = path.join(appPath, COMPUTER_USE_SERVICE_RELATIVE_PATH);
    const key = JSON.stringify({
      bundleIdentifier: this.options.bundleIdentifier,
      desktopBuild: this.options.desktopBuild,
      signingTeamId: this.options.signingTeamId,
    });
    const keyPath = path.join(parentPath, MATERIALIZATION_KEY_FILENAME);
    try {
      if ((await fs.readFile(keyPath, "utf8")).trim() === key) {
        await this.verifyApp({
          appPath,
          bundleIdentifier: this.options.bundleIdentifier,
          serviceExecutablePath,
          signingTeamId: this.options.signingTeamId,
        });
        return { appPath, serviceExecutablePath };
      }
    } catch {
      // Refresh a missing, stale, or invalid canonical helper below.
    }

    await fs.mkdir(parentPath, { recursive: true });
    const stagingPath = path.join(parentPath, `.staging-${randomUUID()}.app`);
    try {
      await this.copyApp(this.options.sourceAppPath, stagingPath);
      const stagingServicePath = path.join(stagingPath, COMPUTER_USE_SERVICE_RELATIVE_PATH);
      await this.verifyApp({
        appPath: stagingPath,
        bundleIdentifier: this.options.bundleIdentifier,
        serviceExecutablePath: stagingServicePath,
        signingTeamId: this.options.signingTeamId,
      });
      const previousPath = await moveDirectoryIntoPlace(stagingPath, appPath);
      try {
        await this.verifyApp({
          appPath,
          bundleIdentifier: this.options.bundleIdentifier,
          serviceExecutablePath,
          signingTeamId: this.options.signingTeamId,
        });
        await fs.writeFile(keyPath, `${key}\n`, "utf8");
        if (previousPath) {
          await fs.rm(previousPath, { force: true, recursive: true });
        }
      } catch (error) {
        await fs.rm(appPath, { force: true, recursive: true });
        if (previousPath) await fs.rename(previousPath, appPath);
        throw error;
      }
      return { appPath, serviceExecutablePath };
    } catch (error) {
      await fs.rm(stagingPath, { force: true, recursive: true });
      throw error;
    }
  }
}

type ComputerUseServiceManagerOptions = {
  addon: Pick<
    SkyNativeAddon,
    "computerUseServiceProcessMatchesExecutablePath" | "spawnComputerUseService"
  >;
  isProcessAlive?: (pid: number) => boolean;
  serviceExecutablePath: string;
  terminateManagedProcessOnDispose?: boolean;
  terminateProcess?: (pid: number) => void;
};

function isLiveProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const processState = spawnSync("/bin/ps", ["-o", "state=", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (processState.status !== 0 || processState.error) return false;
  return !processState.stdout.trimStart().startsWith("Z");
}

export class ComputerUseServiceManager {
  private readonly addon: ComputerUseServiceManagerOptions["addon"];
  private ensureInFlight: Promise<number> | null = null;
  private readonly isProcessAlive: (pid: number) => boolean;
  private managedPid: number | null = null;
  private readonly serviceExecutablePath: string;
  private readonly terminateManagedProcessOnDispose: boolean;
  private readonly terminateProcess: (pid: number) => void;

  constructor(options: ComputerUseServiceManagerOptions) {
    this.addon = options.addon;
    this.isProcessAlive = options.isProcessAlive ?? isLiveProcess;
    this.serviceExecutablePath = canonicalExecutablePath(options.serviceExecutablePath);
    this.terminateManagedProcessOnDispose = options.terminateManagedProcessOnDispose ?? false;
    this.terminateProcess = options.terminateProcess ?? ((pid) => process.kill(pid, "SIGTERM"));
  }

  async ensureRunning(): Promise<{ pid: number }> {
    if (this.isManagedProcessValid()) return { pid: this.managedPid! };
    if (this.ensureInFlight) return { pid: await this.ensureInFlight };

    const operation = this.spawnAndValidate().finally(() => {
      if (this.ensureInFlight === operation) this.ensureInFlight = null;
    });
    this.ensureInFlight = operation;
    return { pid: await operation };
  }

  dispose(): void {
    if (this.terminateManagedProcessOnDispose && this.isManagedProcessValid()) {
      this.terminateProcess(this.managedPid!);
    }
    this.managedPid = null;
  }

  private isManagedProcessValid(): boolean {
    return (
      this.managedPid !== null &&
      this.isProcessAlive(this.managedPid) &&
      this.matchesExecutable(this.managedPid)
    );
  }

  private matchesExecutable(pid: number): boolean {
    try {
      return this.addon.computerUseServiceProcessMatchesExecutablePath(
        pid,
        this.serviceExecutablePath,
      );
    } catch {
      return false;
    }
  }

  private async spawnAndValidate(): Promise<number> {
    this.managedPid = null;
    const pid = await this.addon.spawnComputerUseService(this.serviceExecutablePath);
    if (!Number.isSafeInteger(pid) || pid === null || pid <= 0) {
      throw new Error("Computer Use native host did not return a valid process ID");
    }
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      if (this.isProcessAlive(pid) && this.matchesExecutable(pid)) {
        this.managedPid = pid;
        return pid;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Computer Use service did not become a valid managed process");
  }
}

type ComputerUseRuntimeCoordinatorOptions = {
  appMaterializer?: Pick<ComputerUseAppMaterializer, "materialize">;
  browserRuntime: BrowserRuntimeAvailability;
  createNativePipeServer?: (
    handler: (method: string, params: unknown) => Promise<unknown>,
    peerAuthorizationMode: BrowserUsePeerAuthorizationMode,
    peerAuthorizationAddonPath: string,
  ) => ComputerUseHostServicesServer;
  loadAddon?: () => Pick<
    SkyNativeAddon,
    "computerUseServiceProcessMatchesExecutablePath" | "spawnComputerUseService"
  > | null;
  macOSRelease?: string;
  onRuntimeConfigError?: (error: unknown) => void;
  peerAuthorizationMode?: BrowserUsePeerAuthorizationMode;
  platform?: NodeJS.Platform;
  runtimeConfig?: () => ComputerUseRuntimeConfigInput;
  runtimeStateHome: string;
  serviceManager?: Pick<ComputerUseServiceManager, "dispose" | "ensureRunning">;
  terminateManagedServiceOnDispose?: boolean;
  writeRuntimeConfig?: (input: ComputerUseRuntimeConfigWriteInput) => Promise<string>;
};

type ComputerUseHostServicesServer = {
  close(): Promise<void>;
  readonly pipePath: string;
  start(): Promise<void>;
};

export class ComputerUseRuntimeCoordinator {
  private readonly configWriter: ComputerUseRuntimeConfigWriter | null;
  private disposed = false;
  private readonly options: ComputerUseRuntimeCoordinatorOptions;
  private result: ComputerUseRuntimeResult | null = null;
  private startInFlight: Promise<ComputerUseRuntimeResult> | null = null;
  private nativePipeServer: ComputerUseHostServicesServer | null = null;
  private serviceManager: Pick<ComputerUseServiceManager, "dispose" | "ensureRunning"> | null =
    null;

  constructor(options: ComputerUseRuntimeCoordinatorOptions) {
    this.options = options;
    this.configWriter = options.writeRuntimeConfig ? null : new ComputerUseRuntimeConfigWriter();
  }

  getResult(): ComputerUseRuntimeResult | null {
    return this.result;
  }

  async ensureReady(): Promise<ComputerUseRuntimeResult> {
    if (this.disposed) throw new Error("Computer Use runtime is closed");
    if (this.result?.status === "available") return this.result;
    if (this.startInFlight) return await this.startInFlight;
    const operation = this.start()
      .then((result) => {
        this.result = result;
        return result;
      })
      .finally(() => {
        if (this.startInFlight === operation) this.startInFlight = null;
      });
    this.startInFlight = operation;
    return await operation;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.startInFlight?.catch(() => undefined);
    const nativePipeServer = this.nativePipeServer;
    const serviceManager = this.serviceManager;
    this.nativePipeServer = null;
    this.serviceManager = null;
    this.result = null;
    const results = await Promise.allSettled([
      nativePipeServer?.close() ?? Promise.resolve(),
      Promise.resolve().then(() => serviceManager?.dispose()),
      this.configWriter?.close() ?? Promise.resolve(),
    ]);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, "Computer Use runtime cleanup failed");
    }
  }

  private async start(): Promise<ComputerUseRuntimeResult> {
    const platform = this.options.platform ?? process.platform;
    if (platform !== "darwin") {
      return {
        message: `Computer Use is unavailable on ${platform}`,
        reason: "platform-unsupported",
        status: "unavailable",
      };
    }
    const runtime = this.options.browserRuntime;
    if (runtime.status === "unavailable") {
      return {
        message: runtime.message,
        reason: "runtime-unavailable",
        status: "unavailable",
      };
    }
    const capability = runtime.bundle.manifest.capabilities.computerUse;
    if (capability.status === "unavailable") {
      return {
        message: "Computer Use is unavailable for this architecture",
        reason: "architecture-unsupported",
        status: "unavailable",
      };
    }
    if (!isMacOSVersionAtLeast(capability.minimumMacOSVersion, this.options.macOSRelease)) {
      return {
        message: `Computer Use requires macOS ${capability.minimumMacOSVersion} or later`,
        reason: "macos-version-unsupported",
        status: "unavailable",
      };
    }
    try {
      await (this.options.writeRuntimeConfig ?? this.configWriter!.write.bind(this.configWriter))({
        ...this.options.runtimeConfig?.(),
        runtimeStateHome: this.options.runtimeStateHome,
      });
    } catch (error) {
      this.options.onRuntimeConfigError?.(error);
    }
    const addon = (this.options.loadAddon ?? (() => loadSkyNativeAddon()))();
    if (
      !addon ||
      typeof addon.spawnComputerUseService !== "function" ||
      typeof addon.computerUseServiceProcessMatchesExecutablePath !== "function"
    ) {
      return {
        message: "Computer Use native host is unavailable",
        reason: "native-addon-unavailable",
        status: "unavailable",
      };
    }
    if (!runtime.bundle.paths.computerUseApp) {
      return {
        message: "Computer Use helper bundle is missing",
        reason: "helper-invalid",
        status: "unavailable",
      };
    }

    let helper: { appPath: string; serviceExecutablePath: string };
    try {
      helper = await (
        this.options.appMaterializer ??
        new ComputerUseAppMaterializer({
          bundleIdentifier: capability.appBundleIdentifier,
          desktopBuild: runtime.bundle.manifest.desktopBuild,
          runtimeStateHome: this.options.runtimeStateHome,
          signingTeamId: capability.signingTeamId,
          sourceAppPath: runtime.bundle.paths.computerUseApp,
        })
      ).materialize();
    } catch (error) {
      return {
        message: `Computer Use helper materialization failed: ${boundedMessage(error)}`,
        reason: "helper-materialization-failed",
        status: "unavailable",
      };
    }

    const serviceManager =
      this.options.serviceManager ??
      new ComputerUseServiceManager({
        addon,
        serviceExecutablePath: helper.serviceExecutablePath,
        terminateManagedProcessOnDispose: this.options.terminateManagedServiceOnDispose,
      });
    const peerAuthorizationMode = this.options.peerAuthorizationMode ?? "development";
    const handler = async (method: string, params: unknown): Promise<unknown> => {
      if (method !== "ensureService") {
        throw new Error(`Unsupported host-services method: ${method}`);
      }
      const service = params && typeof params === "object" ? Reflect.get(params, "service") : null;
      if (service !== "computer-use") {
        throw new Error("Unsupported host service");
      }
      await serviceManager.ensureRunning();
      return {};
    };
    const createServer =
      this.options.createNativePipeServer ??
      ((requestHandler, mode, addonPath) =>
        new BrowserUseNativePipeServer({
          handler: async (request) => await requestHandler(request.method, request.params),
          nativePipeDirectory: path.join("/tmp", "nodex-host-services"),
          socketPeerAuthorizer: createBrowserUsePeerAuthorizer({
            addonPath,
            mode,
          }),
        }));
    const server = createServer(
      handler,
      peerAuthorizationMode,
      runtime.bundle.paths.peerAuthorization,
    );
    try {
      await server.start();
    } catch (error) {
      serviceManager.dispose();
      return {
        message: `Computer Use host-services pipe failed: ${boundedMessage(error)}`,
        reason: "host-services-failed",
        status: "unavailable",
      };
    }
    this.serviceManager = serviceManager;
    this.nativePipeServer = server;
    return {
      appPath: helper.appPath,
      hostServicesPipePath: server.pipePath,
      serviceExecutablePath: helper.serviceExecutablePath,
      status: "available",
    };
  }
}
