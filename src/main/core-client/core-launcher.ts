import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { CoreClient } from "./core-client";

const DEFAULT_STARTUP_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const MAX_STARTUP_STDERR_CHARS = 16_384;

export interface ResolveCoreExecutableInput {
  readonly appResourcesPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly isPackaged: boolean;
  readonly repositoryRoot?: string;
}

export interface ConnectOrStartCoreInput extends ResolveCoreExecutableInput {
  readonly buildId: string;
  readonly maximumJsonResponseBytes?: number;
  readonly nodexHome: string;
  readonly pollIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly startupTimeoutMs?: number;
}

export interface CoreLaunchResult {
  readonly client: CoreClient;
  readonly executablePath: string;
  readonly startedProcessId: number | null;
}

interface ChildExitState {
  code: number | null;
  error: Error | null;
  exited: boolean;
  stderr: string;
}

interface LegacyMigratorManifest {
  readonly bundle: {
    readonly sha256: string;
  };
}

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const requireAbsolutePath = (candidate: string, label: string): string => {
  if (path.isAbsolute(candidate)) return path.normalize(candidate);
  throw new Error(`${label} must be absolute`);
};

export function resolveCoreExecutable(input: ResolveCoreExecutableInput): string {
  const environment = input.environment ?? process.env;
  const override = environment.NODEX_CORE_EXECUTABLE?.trim();
  if (override) return requireAbsolutePath(override, "NODEX_CORE_EXECUTABLE");

  if (input.isPackaged) {
    if (!input.appResourcesPath) {
      throw new Error("Packaged Core startup requires an app resources path");
    }
    return path.join(
      requireAbsolutePath(input.appResourcesPath, "App resources path"),
      "bin/nodex-core",
    );
  }

  return path.join(
    requireAbsolutePath(
      input.repositoryRoot ?? process.cwd(),
      "Core repository root",
    ),
    "target/debug/nodex-core",
  );
}

function validateCoreExecutable(executablePath: string): void {
  const stats = lstatSync(executablePath);
  if (stats.isSymbolicLink()) throw new Error("Core executable must not be a symlink");
  if (!stats.isFile()) throw new Error("Core executable must be a regular file");
  accessSync(executablePath, constants.X_OK);
}

const legacyMigratorResourceRoot = (input: ResolveCoreExecutableInput): string => {
  if (input.isPackaged) {
    if (!input.appResourcesPath) {
      throw new Error("Packaged legacy migration requires an app resources path");
    }
    return requireAbsolutePath(input.appResourcesPath, "App resources path");
  }
  return path.join(
    requireAbsolutePath(
      input.repositoryRoot ?? process.cwd(),
      "Core repository root",
    ),
    "resources",
  );
};

const requireSha256 = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Legacy migrator manifest has an invalid bundle digest");
  }
  return value;
};

export function resolveLegacyMigratorEnvironment(
  input: ResolveCoreExecutableInput,
): NodeJS.ProcessEnv {
  const environment = input.environment ?? process.env;
  const configuredExecutable = environment.NODEX_LEGACY_MIGRATOR_EXECUTABLE?.trim();
  const configuredScript = environment.NODEX_LEGACY_MIGRATOR_SCRIPT?.trim();
  const configuredSha256 = environment.NODEX_LEGACY_MIGRATOR_SHA256?.trim();
  if (configuredExecutable && configuredScript && configuredSha256) {
    return {
      NODEX_LEGACY_MIGRATOR_EXECUTABLE: requireAbsolutePath(
        configuredExecutable,
        "NODEX_LEGACY_MIGRATOR_EXECUTABLE",
      ),
      NODEX_LEGACY_MIGRATOR_SCRIPT: requireAbsolutePath(
        configuredScript,
        "NODEX_LEGACY_MIGRATOR_SCRIPT",
      ),
      NODEX_LEGACY_MIGRATOR_SHA256: requireSha256(configuredSha256),
    };
  }
  if (configuredExecutable || configuredScript || configuredSha256) {
    throw new Error("Legacy migrator overrides must be configured together");
  }

  const resourceRoot = legacyMigratorResourceRoot(input);
  const script = path.join(resourceRoot, "legacy-profile-migrator.mjs");
  const manifestPath = path.join(resourceRoot, "legacy-profile-migrator.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as LegacyMigratorManifest;
  return {
    NODEX_LEGACY_MIGRATOR_EXECUTABLE: requireAbsolutePath(
      process.execPath,
      "Electron executable",
    ),
    NODEX_LEGACY_MIGRATOR_SCRIPT: script,
    NODEX_LEGACY_MIGRATOR_SHA256: requireSha256(manifest.bundle?.sha256),
  };
}

const appendBoundedStderr = (current: string, chunk: string): string =>
  `${current}${chunk}`.slice(-MAX_STARTUP_STDERR_CHARS);

const connect = (input: ConnectOrStartCoreInput): Promise<CoreClient> =>
  CoreClient.connect({
    nodexHome: input.nodexHome,
    clientKind: "electron_host",
    buildId: input.buildId,
    maximumJsonResponseBytes: input.maximumJsonResponseBytes,
    requestTimeoutMs: input.requestTimeoutMs,
  });

export async function connectOrStartCore(
  input: ConnectOrStartCoreInput,
): Promise<CoreLaunchResult> {
  requireAbsolutePath(input.nodexHome, "Nodex home");
  const executablePath = resolveCoreExecutable(input);

  try {
    return {
      client: await connect(input),
      executablePath,
      startedProcessId: null,
    };
  } catch {
    // A missing or stale runtime is resolved by the single-winner Core startup path.
  }

  validateCoreExecutable(executablePath);
  const legacyMigratorEnvironment = resolveLegacyMigratorEnvironment(input);
  const child = spawn(executablePath, ["--home", input.nodexHome], {
    detached: true,
    env: {
      ...process.env,
      ...input.environment,
      ...legacyMigratorEnvironment,
      NODEX_INTERNAL_APP_PACKAGED: input.isPackaged ? "true" : "false",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const startedProcessId = child.pid ?? null;
  const exit: ChildExitState = {
    code: null,
    error: null,
    exited: false,
    stderr: "",
  };
  const stderr = child.stderr as (NonNullable<typeof child.stderr> & {
    unref?: () => void;
  }) | null;
  stderr?.setEncoding("utf8");
  stderr?.on("data", (chunk: string) => {
    exit.stderr = appendBoundedStderr(exit.stderr, chunk);
  });
  stderr?.unref?.();
  child.once("error", (error) => {
    exit.error = error;
  });
  child.once("close", (code) => {
    exit.code = code;
    exit.exited = true;
  });
  child.unref();

  const startupTimeoutMs = input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + startupTimeoutMs;
  let lastConnectionError: unknown;

  while (Date.now() < deadline) {
    if (exit.error) throw new Error("Could not start native Rust Core", { cause: exit.error });
    if (exit.exited) {
      const status = exit.code === null ? "without an exit code" : `with code ${exit.code}`;
      const diagnostic = exit.stderr.trim();
      const suffix = diagnostic ? `: ${diagnostic}` : "";
      throw new Error(`Native Rust Core exited during startup ${status}${suffix}`);
    }

    try {
      return {
        client: await connect(input),
        executablePath,
        startedProcessId,
      };
    } catch (error) {
      lastConnectionError = error;
    }
    await delay(pollIntervalMs);
  }

  const diagnostic = exit.stderr.trim();
  const suffix = diagnostic ? `: ${diagnostic}` : "";
  throw new Error(
    `Native Rust Core did not become ready before the startup deadline${suffix}`,
    { cause: lastConnectionError },
  );
}
