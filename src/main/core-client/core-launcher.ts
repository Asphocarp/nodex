import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import type { components } from "@nodex/core-protocol";
import { CoreClient } from "./core-client";

const DEFAULT_STARTUP_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const MAX_STARTUP_STDERR_CHARS = 16_384;
const MAX_SELECTION_STDOUT_CHARS = 128 * 1024;
const MAX_SELECTION_STDOUT_LINE_CHARS = 64 * 1024;
const MAX_STARTUP_EVENT_COUNT = 32;

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
  readonly onStartupEvent?: (event: CoreStartupEvent) => void;
  readonly pollIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly startupTimeoutMs?: number;
}

export interface CoreLaunchResult {
  readonly client: CoreClient;
  readonly executablePath: string;
  readonly startedProcessId: number | null;
  readonly timings: CoreLaunchTimings;
}

export type CoreStartupEvent =
  | { readonly artifactHashMs: number; readonly kind: "candidate_checked" }
  | {
    readonly fromVersion: number;
    readonly kind: "migration_started";
    readonly toVersion: number;
  }
  | {
    readonly createdFresh: boolean;
    readonly kind: "store_ready";
    readonly migratedFromVersion: number | null;
    readonly storeOpenMs: number;
  };

export interface CoreLaunchTimings {
  readonly artifactValidationMs: number;
  readonly connectMs: number;
  readonly disposition: CoreSelectionResult["disposition"];
  readonly reason: CoreSelectionResult["reason"];
  readonly selectionMs: number;
  readonly totalMs: number;
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
type CoreStartupEventFrame = components["schemas"]["CoreStartupEventFrame"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireNonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new Error(`Native Rust Core startup event has invalid ${label}`);
};

export function parseCoreStartupEventFrame(value: unknown): CoreStartupEvent | null {
  if (!isRecord(value) || !("startup_event_version" in value)) return null;
  if (value.startup_event_version !== 1 || !isRecord(value.event)) {
    throw new Error("Native Rust Core startup event version is unsupported");
  }
  const frame = value as unknown as CoreStartupEventFrame;
  const event = frame.event;
  if (event.kind === "candidate_checked") {
    return {
      artifactHashMs: requireNonNegativeInteger(event.artifact_hash_ms, "artifact_hash_ms"),
      kind: "candidate_checked",
    };
  }
  if (event.kind === "migration_started") {
    return {
      fromVersion: requireNonNegativeInteger(event.from_version, "from_version"),
      kind: "migration_started",
      toVersion: requireNonNegativeInteger(event.to_version, "to_version"),
    };
  }
  if (event.kind === "store_ready") {
    if (typeof event.created_fresh !== "boolean") {
      throw new Error("Native Rust Core startup event has invalid created_fresh");
    }
    const migratedFromVersion = event.migrated_from_version === null
      ? null
      : requireNonNegativeInteger(event.migrated_from_version, "migrated_from_version");
    return {
      createdFresh: event.created_fresh,
      kind: "store_ready",
      migratedFromVersion,
      storeOpenMs: requireNonNegativeInteger(event.store_open_ms, "store_open_ms"),
    };
  }
  throw new Error("Native Rust Core startup event kind is unsupported");
}

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
  const launchStartedAt = performance.now();
  requireAbsolutePath(input.nodexHome, "Nodex home");
  const executablePath = resolveCoreExecutable(input);
  validateCoreExecutable(executablePath);
  const artifactValidationStartedAt = performance.now();
  const expectedArtifactDigest = expectedCoreArtifactDigest(input, executablePath);
  const artifactValidationMs = performance.now() - artifactValidationStartedAt;
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
      NODEX_INTERNAL_STARTUP_EVENTS_VERSION: "1",
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
  const selectionStartedAt = performance.now();
  const selection = await readSelectionResult(
    child,
    exit,
    startupTimeoutMs,
    input.onStartupEvent,
  );
  const selectionMs = performance.now() - selectionStartedAt;
  if (selection.descriptor.artifact.sha256 !== expectedArtifactDigest) {
    throw new Error("Selected Core artifact does not match the launched candidate");
  }
  const startedProcessId = selection.disposition === "started" ? child.pid ?? null : null;
  child.unref();
  let lastConnectionError: unknown;
  const connectStartedAt = performance.now();

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
        timings: {
          artifactValidationMs,
          connectMs: performance.now() - connectStartedAt,
          disposition: selection.disposition,
          reason: selection.reason,
          selectionMs,
          totalMs: performance.now() - launchStartedAt,
        },
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
  onStartupEvent?: (event: CoreStartupEvent) => void,
): Promise<CoreSelectionResult> =>
  new Promise((resolve, reject) => {
    const stdout = child.stdout;
    if (!stdout) {
      reject(new Error("Native Rust Core selection stdout is unavailable"));
      return;
    }
    stdout.setEncoding("utf8");
    let buffered = "";
    let startupEventCount = 0;
    let totalCharacters = 0;
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
      if (
        buffered.length > MAX_SELECTION_STDOUT_LINE_CHARS
        && !buffered.includes("\n")
      ) {
        cleanup();
        reject(new Error("Native Rust Core selection result is oversized"));
        return;
      }
      for (;;) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) return;
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        totalCharacters += line.length + 1;
        if (
          line.length > MAX_SELECTION_STDOUT_LINE_CHARS
          || totalCharacters > MAX_SELECTION_STDOUT_CHARS
        ) {
          cleanup();
          reject(new Error("Native Rust Core selection result is oversized"));
          return;
        }
        try {
          const value = JSON.parse(line) as unknown;
          let startupEvent: CoreStartupEvent | null;
          try {
            startupEvent = parseCoreStartupEventFrame(value);
          } catch (error) {
            if (isRecord(value) && "startup_event_version" in value) {
              exit.stderr = appendBoundedStderr(
                exit.stderr,
                `Ignored invalid Core startup event: ${error instanceof Error ? error.message : String(error)}\n`,
              );
              continue;
            }
            throw error;
          }
          if (startupEvent) {
            startupEventCount += 1;
            if (startupEventCount > MAX_STARTUP_EVENT_COUNT) {
              throw new Error("Native Rust Core returned too many startup events");
            }
            try {
              onStartupEvent?.(startupEvent);
            } catch {
              // Startup events are advisory and must not affect authority selection.
            }
            continue;
          }
          const selection = value as CoreSelectionResult;
          if (
            selection.selection_version !== 1
            || (selection.disposition !== "started" && selection.disposition !== "reused")
            || typeof selection.descriptor?.manifest_digest !== "string"
          ) {
            throw new Error("Native Rust Core returned an invalid selection result");
          }
          cleanup();
          resolve(selection);
          return;
        } catch (error) {
          cleanup();
          reject(new Error("Native Rust Core selection result is invalid", { cause: error }));
          return;
        }
      }
    };
    stdout.on("data", onData);
    child.once("close", onClose);
    child.once("error", onError);
  });
