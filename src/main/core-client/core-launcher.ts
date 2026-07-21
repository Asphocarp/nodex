import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync } from "node:fs";
import path from "node:path";

import { CoreClient } from "./core-client";

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 25;

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
  const child = spawn(executablePath, ["--home", input.nodexHome], {
    detached: true,
    env: {
      ...process.env,
      ...input.environment,
      NODEX_INTERNAL_APP_PACKAGED: input.isPackaged ? "true" : "false",
    },
    stdio: "ignore",
  });
  const startedProcessId = child.pid ?? null;
  const exit: ChildExitState = { code: null, error: null };
  child.once("error", (error) => {
    exit.error = error;
  });
  child.once("exit", (code) => {
    exit.code = code;
  });
  child.unref();

  const startupTimeoutMs = input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + startupTimeoutMs;
  let lastConnectionError: unknown;

  while (Date.now() < deadline) {
    if (exit.error) throw new Error("Could not start native Rust Core", { cause: exit.error });
    if (exit.code !== null && exit.code !== 0) {
      throw new Error(`Native Rust Core exited during startup with code ${exit.code}`);
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

  throw new Error("Native Rust Core did not become ready before the startup deadline", {
    cause: lastConnectionError,
  });
}
