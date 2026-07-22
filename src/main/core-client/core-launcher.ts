import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import type { components } from "@nodex/core-protocol";
import { CoreClient } from "./core-client";

const DEFAULT_STARTUP_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const MAX_STARTUP_STDERR_CHARS = 16_384;
const MAX_SELECTION_STDOUT_CHARS = 64 * 1024;

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

type CoreSelectionResult = components["schemas"]["CoreSelectionResult"];

interface NativeCoreManifest {
  readonly binaries?: readonly {
    readonly name?: unknown;
    readonly sourceSha256?: unknown;
  }[];
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

const sha256File = (filePath: string): string =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const expectedCoreArtifactDigest = (
  input: ResolveCoreExecutableInput,
  executablePath: string,
): string => {
  const actual = sha256File(executablePath);
  const override = (input.environment ?? process.env).NODEX_CORE_EXECUTABLE?.trim();
  if (override) return actual;
  if (!input.isPackaged) return actual;
  if (!input.appResourcesPath) {
    throw new Error("Packaged Core startup requires an app resources path");
  }
  const manifestPath = path.join(
    requireAbsolutePath(input.appResourcesPath, "App resources path"),
    "bin/rust-core-runtime.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as NativeCoreManifest;
  const expected = manifest.binaries?.find((binary) => binary.name === "nodex-core")
    ?.sourceSha256;
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/u.test(expected)) {
    throw new Error("Packaged native runtime manifest omits the Core artifact digest");
  }
  if (actual !== expected) {
    throw new Error("Packaged Core executable does not match its signed runtime manifest");
  }
  return actual;
};

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
  validateCoreExecutable(executablePath);
  const expectedArtifactDigest = expectedCoreArtifactDigest(input, executablePath);
  const legacyMigratorEnvironment = resolveLegacyMigratorEnvironment(input);
  const child = spawn(executablePath, [
    "--home",
    input.nodexHome,
    "--selection-policy",
    "prefer-current-artifact",
    "--launcher",
    "electron-host",
  ], {
    detached: true,
    env: {
      ...process.env,
      ...input.environment,
      ...legacyMigratorEnvironment,
      NODEX_INTERNAL_APP_PACKAGED: input.isPackaged ? "true" : "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  const startupTimeoutMs = input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + startupTimeoutMs;
  const selection = await readSelectionResult(child, exit, startupTimeoutMs);
  if (selection.descriptor.artifact.sha256 !== expectedArtifactDigest) {
    throw new Error("Selected Core artifact does not match the launched candidate");
  }
  const startedProcessId = selection.disposition === "started" ? child.pid ?? null : null;
  child.unref();
  let lastConnectionError: unknown;

  while (Date.now() < deadline) {
    if (exit.error) throw new Error("Could not start native Rust Core", { cause: exit.error });
    if (exit.exited && !(selection.disposition === "reused" && exit.code === 0)) {
      const status = exit.code === null ? "without an exit code" : `with code ${exit.code}`;
      const diagnostic = exit.stderr.trim();
      const suffix = diagnostic ? `: ${diagnostic}` : "";
      throw new Error(`Native Rust Core exited during startup ${status}${suffix}`);
    }

    try {
      const client = await connect(input);
      if (
        client.handshake.generation.manifest_digest !==
          selection.descriptor.manifest_digest ||
        client.handshake.generation.artifact_sha256 !==
          selection.descriptor.artifact.sha256 ||
        client.handshake.generation.start_nonce !== selection.descriptor.start_nonce
      ) {
        throw new Error("Core generation changed after selector completion");
      }
      return {
        client,
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

const readSelectionResult = (
  child: ReturnType<typeof spawn>,
  exit: ChildExitState,
  timeoutMs: number,
): Promise<CoreSelectionResult> =>
  new Promise((resolve, reject) => {
    const stdout = child.stdout;
    if (!stdout) {
      reject(new Error("Native Rust Core selection stdout is unavailable"));
      return;
    }
    stdout.setEncoding("utf8");
    let buffered = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Native Rust Core selection timed out"));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timeout);
      stdout.removeListener("data", onData);
      child.removeListener("close", onClose);
      child.removeListener("error", onError);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(new Error("Could not start native Rust Core", { cause: error }));
    };
    const onClose = (code: number | null): void => {
      cleanup();
      const diagnostic = exit.stderr.trim();
      reject(
        new Error(
          `Native Rust Core exited before selection with code ${String(code)}${diagnostic ? `: ${diagnostic}` : ""}`,
        ),
      );
    };
    const onData = (chunk: string): void => {
      buffered += chunk;
      if (buffered.length > MAX_SELECTION_STDOUT_CHARS) {
        cleanup();
        reject(new Error("Native Rust Core selection result is oversized"));
        return;
      }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      cleanup();
      try {
        const value = JSON.parse(buffered.slice(0, newline)) as CoreSelectionResult;
        if (
          value.selection_version !== 1 ||
          (value.disposition !== "started" && value.disposition !== "reused") ||
          typeof value.descriptor?.manifest_digest !== "string"
        ) {
          throw new Error("Native Rust Core returned an invalid selection result");
        }
        resolve(value);
      } catch (error) {
        reject(new Error("Native Rust Core selection result is invalid", { cause: error }));
      }
    };
    stdout.on("data", onData);
    child.once("close", onClose);
    child.once("error", onError);
  });
