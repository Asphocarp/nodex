import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { components } from "@nodex/core-protocol";
import { CoreClient } from "../src/main/core-client/core-client";
import {
  ISOLATED_RUN_ID_ENV,
  acquireIsolatedRunLease,
  readIsolatedRunClaim,
  type IsolatedRunClaim,
  type IsolatedRunLease,
} from "../src/main/core-client/isolated-run-ownership";
import { readCoreRuntimeConnection } from "../src/main/core-client/runtime-descriptor";
import type { CoreRuntimeDescriptor } from "../src/main/core-client/types";

const CORE_BUILD_ID = "nodex-isolated-run-supervisor";
const DEFAULT_CORE_IDLE_TIMEOUT_MS = "30000";
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const FOREGROUND_INTERRUPT_GRACE_MS = 1_500;
const FOREGROUND_TERMINATE_GRACE_MS = 1_500;
const FOREGROUND_KILL_GRACE_MS = 1_000;
const FOREGROUND_POLL_INTERVAL_MS = 25;
const MAX_DIAGNOSTIC_CHARS = 512;

export type IsolatedRunScript =
  | "dev"
  | "build:run"
  | "build:run:prepared";
export type IsolatedCoreCleanupStatus =
  | "not_started"
  | "stopped"
  | "not_owner"
  | "generation_changed"
  | "failed";

export interface IsolatedCoreCleanupResult {
  readonly status: IsolatedCoreCleanupStatus;
  readonly safeToDeleteRunRoot: boolean;
  readonly reason?: string;
}

export interface SupervisedRunResult {
  readonly childExitCode: number;
  readonly cleanupStatus: IsolatedCoreCleanupStatus;
  readonly safeToDeleteRunRoot: boolean;
}

type RuntimeGeneration = components["schemas"]["RuntimeGenerationIdentity"];
type ShutdownResponse = components["schemas"]["ShutdownResponse"];

interface CoreShutdownClient {
  readonly handshake: {
    readonly generation: RuntimeGeneration;
  };
  shutdown(): Promise<ShutdownResponse>;
}

export interface IsolatedCoreCleanupDependencies {
  readonly connectCore: (input: {
    readonly nodexHome: string;
    readonly clientKind: "native_cli";
    readonly buildId: string;
    readonly requestTimeoutMs: number;
  }) => Promise<CoreShutdownClient>;
  readonly delay: (durationMs: number) => Promise<void>;
  readonly inspectRuntimeEvidence: (
    nodexHome: string,
  ) => CoreRuntimeEvidence;
  readonly isPidAlive: (pid: number) => boolean;
  readonly now: () => number;
  readonly readClaim: (nodexHome: string) => IsolatedRunClaim | null;
  readonly readRuntimeGeneration: (nodexHome: string) => RuntimeGeneration;
}

export interface SupervisorSignalSource {
  on(
    signal: "SIGINT" | "SIGTERM",
    listener: () => void,
  ): unknown;
  off(
    signal: "SIGINT" | "SIGTERM",
    listener: () => void,
  ): unknown;
}

export interface IsolatedRunSupervisorDependencies {
  readonly cleanupDependencies?: Partial<IsolatedCoreCleanupDependencies>;
  readonly delay: (durationMs: number) => Promise<void>;
  readonly forceExit: (exitCode: number) => void;
  readonly generateRunId: () => string;
  readonly isProcessGroupAlive: (processGroupId: number) => boolean;
  readonly now: () => number;
  readonly signalSource: SupervisorSignalSource;
  readonly signalProcessGroup: (
    processGroupId: number,
    signal: NodeJS.Signals,
  ) => void;
  readonly spawnChild: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
}

export interface SuperviseIsolatedRunInput {
  readonly environment: NodeJS.ProcessEnv;
  readonly nodexHome: string;
  readonly repositoryRoot: string;
  readonly runScript: IsolatedRunScript;
  readonly dependencies?: Partial<IsolatedRunSupervisorDependencies>;
}

type CoreRuntimeEvidence = "none" | "partial" | "complete";
type SupervisorSignal = "SIGINT" | "SIGTERM";

interface ChildOutcome {
  readonly code: number | null;
  readonly error: Error | null;
  readonly signal: NodeJS.Signals | null;
}

const isFileSystemError = (
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && error.code === code;

const requireAbsolutePath = (candidate: string, label: string): string => {
  if (path.isAbsolute(candidate)) return path.normalize(candidate);
  throw new Error(`${label} must be absolute`);
};

const boundedReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/gu, " ").slice(0, MAX_DIAGNOSTIC_CHARS);
};

const runtimeEntryPaths = (nodexHome: string) => {
  const runtimeDirectory = path.join(nodexHome, "run/core");
  return {
    runtimeDirectory,
    descriptor: path.join(runtimeDirectory, "core.json"),
    auth: path.join(runtimeDirectory, "core.auth"),
    socket: path.join(runtimeDirectory, "core.sock"),
  };
};

const defaultInspectRuntimeEvidence = (
  nodexHome: string,
): CoreRuntimeEvidence => {
  const paths = runtimeEntryPaths(nodexHome);
  try {
    const runtimeStats = lstatSync(paths.runtimeDirectory);
    if (runtimeStats.isSymbolicLink()) {
      throw new Error("Core runtime directory must not be a symlink");
    }
    if (!runtimeStats.isDirectory()) {
      throw new Error("Core runtime path must be a directory");
    }
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return "none";
    throw error;
  }

  let present = 0;
  for (const entryPath of [paths.descriptor, paths.auth, paths.socket]) {
    try {
      lstatSync(entryPath);
      present += 1;
    } catch (error) {
      if (!isFileSystemError(error, "ENOENT")) throw error;
    }
  }
  if (present === 0) return "none";
  if (present === 3) return "complete";
  return "partial";
};

const defaultIsPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isFileSystemError(error, "ESRCH")) return false;
    if (isFileSystemError(error, "EPERM")) return true;
    throw error;
  }
};

const runtimeGenerationFromDescriptor = (
  descriptor: CoreRuntimeDescriptor,
): RuntimeGeneration => ({
  artifact_sha256: descriptor.artifact.sha256,
  manifest_digest: descriptor.manifest_digest,
  pid: descriptor.pid,
  profile_id: descriptor.profile_id,
  readiness_generation: descriptor.readiness_generation,
  start_nonce: descriptor.start_nonce,
  store_epoch: descriptor.store_epoch,
});

const sameGeneration = (
  left: RuntimeGeneration,
  right: RuntimeGeneration,
): boolean =>
  left.artifact_sha256 === right.artifact_sha256 &&
  left.manifest_digest === right.manifest_digest &&
  left.pid === right.pid &&
  left.profile_id === right.profile_id &&
  left.readiness_generation === right.readiness_generation &&
  left.start_nonce === right.start_nonce &&
  left.store_epoch === right.store_epoch;

const defaultCleanupDependencies: IsolatedCoreCleanupDependencies = {
  connectCore: (input) => CoreClient.connect(input),
  delay: (durationMs) =>
    new Promise((resolve) => setTimeout(resolve, durationMs)),
  inspectRuntimeEvidence: defaultInspectRuntimeEvidence,
  isPidAlive: defaultIsPidAlive,
  now: Date.now,
  readClaim: readIsolatedRunClaim,
  readRuntimeGeneration: (nodexHome) =>
    runtimeGenerationFromDescriptor(
      readCoreRuntimeConnection(nodexHome).descriptor,
    ),
};

const resolveCleanupDependencies = (
  overrides: Partial<IsolatedCoreCleanupDependencies> | undefined,
): IsolatedCoreCleanupDependencies => ({
  ...defaultCleanupDependencies,
  ...overrides,
});

const cleanupFailure = (
  status: Exclude<
    IsolatedCoreCleanupStatus,
    "not_started" | "stopped"
  >,
  reason: string,
): IsolatedCoreCleanupResult => ({
  status,
  safeToDeleteRunRoot: false,
  reason,
});

export async function cleanupIsolatedCore(input: {
  readonly lease: IsolatedRunLease;
  readonly nodexHome: string;
  readonly releaseLeaseOnSuccess?: boolean;
  readonly runId: string;
  readonly dependencies?: Partial<IsolatedCoreCleanupDependencies>;
  readonly pollIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
}): Promise<IsolatedCoreCleanupResult> {
  const dependencies = resolveCleanupDependencies(input.dependencies);
  const nodexHome = requireAbsolutePath(input.nodexHome, "Nodex home");

  try {
    const evidence = dependencies.inspectRuntimeEvidence(nodexHome);
    const claim = dependencies.readClaim(nodexHome);
    if (evidence === "none") {
      if (claim && claim.runId !== input.runId) {
        return cleanupFailure(
          "not_owner",
          "The isolated run claim belongs to another run",
        );
      }
      if (claim?.phase === "starting") {
        return cleanupFailure(
          "failed",
          "Primary Electron startup did not reach confirmed Core readiness",
        );
      }
      if (input.releaseLeaseOnSuccess !== false) input.lease.release();
      return { status: "not_started", safeToDeleteRunRoot: true };
    }
    if (!claim || claim.runId !== input.runId) {
      return cleanupFailure(
        "not_owner",
        "This isolated run never became the primary Electron host",
      );
    }

    const client = await dependencies.connectCore({
      nodexHome,
      clientKind: "native_cli",
      buildId: CORE_BUILD_ID,
      requestTimeoutMs:
        input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    });
    const generation = client.handshake.generation;
    const shutdown = await client.shutdown();
    if (shutdown.status !== "draining") {
      return cleanupFailure(
        "failed",
        `Core rejected isolated shutdown with status ${shutdown.status}`,
      );
    }

    const shutdownTimeoutMs =
      input.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    const deadline = dependencies.now() + shutdownTimeoutMs;
    while (true) {
      const currentEvidence =
        dependencies.inspectRuntimeEvidence(nodexHome);
      const pidAlive = dependencies.isPidAlive(generation.pid);
      if (currentEvidence === "none" && !pidAlive) {
        if (input.releaseLeaseOnSuccess !== false) input.lease.release();
        return { status: "stopped", safeToDeleteRunRoot: true };
      }
      if (currentEvidence === "complete") {
        try {
          const currentGeneration =
            dependencies.readRuntimeGeneration(nodexHome);
          if (!sameGeneration(currentGeneration, generation)) {
            return cleanupFailure(
              "generation_changed",
              "Core runtime generation changed during isolated shutdown",
            );
          }
        } catch (error) {
          if (!isFileSystemError(error, "ENOENT")) throw error;
          // Graceful drain removes the fixed runtime entries one at a time.
        }
      }
      if (dependencies.now() >= deadline) {
        return cleanupFailure(
          "failed",
          "Timed out waiting for isolated Core to exit",
        );
      }
      await dependencies.delay(
        input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      );
    }
  } catch (error) {
    return cleanupFailure("failed", boundedReason(error));
  }
}

export function parseIsolatedRunSupervisorArguments(
  args: readonly string[],
): IsolatedRunScript {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (normalizedArgs.length !== 1) {
    throw new Error(
      "Usage: isolated-run-supervisor.ts -- <dev|build:run|build:run:prepared>",
    );
  }
  const runScript = normalizedArgs[0];
  if (runScript === "dev" ||
      runScript === "build:run" ||
      runScript === "build:run:prepared") {
    return runScript;
  }
  throw new Error(`Unsupported isolated run script: ${runScript ?? "<missing>"}`);
}

const waitForChild = (child: ChildProcess): Promise<ChildOutcome> =>
  new Promise((resolve) => {
    let spawnError: Error | null = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      resolve({ code, error: spawnError, signal });
    });
  });

const signalExitCode = (signal: SupervisorSignal): number =>
  signal === "SIGINT" ? 130 : 143;

const childExitCode = (
  outcome: ChildOutcome,
  requestedSignal: SupervisorSignal | null,
): number => {
  if (requestedSignal) return signalExitCode(requestedSignal);
  if (outcome.code !== null) return outcome.code;
  if (outcome.signal === "SIGINT" || outcome.signal === "SIGTERM") {
    return signalExitCode(outcome.signal);
  }
  return 1;
};

const defaultSupervisorDependencies: IsolatedRunSupervisorDependencies = {
  delay: (durationMs) =>
    new Promise((resolve) => setTimeout(resolve, durationMs)),
  forceExit: (exitCode) => process.exit(exitCode),
  generateRunId: randomUUID,
  isProcessGroupAlive: (processGroupId) => {
    try {
      process.kill(-processGroupId, 0);
      return true;
    } catch (error) {
      if (isFileSystemError(error, "ESRCH")) return false;
      if (isFileSystemError(error, "EPERM")) return true;
      throw error;
    }
  },
  now: Date.now,
  signalSource: process,
  signalProcessGroup: (processGroupId, signal) => {
    try {
      process.kill(-processGroupId, signal);
    } catch (error) {
      if (!isFileSystemError(error, "ESRCH")) throw error;
    }
  },
  spawnChild: (command, args, options) =>
    spawn(command, [...args], options),
};

const resolveSupervisorDependencies = (
  overrides: Partial<IsolatedRunSupervisorDependencies> | undefined,
): IsolatedRunSupervisorDependencies => ({
  ...defaultSupervisorDependencies,
  ...overrides,
});

const waitForProcessGroupExit = async (input: {
  readonly dependencies: IsolatedRunSupervisorDependencies;
  readonly processGroupId: number;
  readonly timeoutMs: number;
}): Promise<boolean> => {
  const deadline = input.dependencies.now() + input.timeoutMs;
  while (input.dependencies.isProcessGroupAlive(input.processGroupId)) {
    if (input.dependencies.now() >= deadline) return false;
    await input.dependencies.delay(FOREGROUND_POLL_INTERVAL_MS);
  }
  return true;
};

const terminateForegroundProcessGroup = async (input: {
  readonly dependencies: IsolatedRunSupervisorDependencies;
  readonly processGroupId: number;
  readonly requestedSignal: SupervisorSignal;
}): Promise<void> => {
  input.dependencies.signalProcessGroup(
    input.processGroupId,
    input.requestedSignal,
  );
  if (await waitForProcessGroupExit({
    dependencies: input.dependencies,
    processGroupId: input.processGroupId,
    timeoutMs: FOREGROUND_INTERRUPT_GRACE_MS,
  })) return;

  input.dependencies.signalProcessGroup(input.processGroupId, "SIGTERM");
  if (await waitForProcessGroupExit({
    dependencies: input.dependencies,
    processGroupId: input.processGroupId,
    timeoutMs: FOREGROUND_TERMINATE_GRACE_MS,
  })) return;

  input.dependencies.signalProcessGroup(input.processGroupId, "SIGKILL");
  if (await waitForProcessGroupExit({
    dependencies: input.dependencies,
    processGroupId: input.processGroupId,
    timeoutMs: FOREGROUND_KILL_GRACE_MS,
  })) return;

  throw new Error("Timed out terminating the isolated foreground process group");
};

export async function superviseIsolatedRun(
  input: SuperviseIsolatedRunInput,
): Promise<SupervisedRunResult> {
  const nodexHome = requireAbsolutePath(input.nodexHome, "Nodex home");
  const repositoryRoot = requireAbsolutePath(
    input.repositoryRoot,
    "Repository root",
  );
  const dependencies = resolveSupervisorDependencies(input.dependencies);
  const runId = dependencies.generateRunId();
  const lease = acquireIsolatedRunLease({
    nodexHome,
    runId,
    supervisorPid: process.pid,
  });
  const environment: NodeJS.ProcessEnv = {
    ...input.environment,
    [ISOLATED_RUN_ID_ENV]: runId,
    NODEX_CORE_IDLE_TIMEOUT_MS:
      input.environment.NODEX_CORE_IDLE_TIMEOUT_MS ??
      DEFAULT_CORE_IDLE_TIMEOUT_MS,
  };

  let child: ChildProcess | null = null;
  let childClosed = false;
  let requestedSignal: SupervisorSignal | null = null;
  let signalCount = 0;
  let foregroundTermination: Promise<void> | null = null;
  let foregroundTerminationError: Error | null = null;

  const beginForegroundTermination = (
    signal: SupervisorSignal,
  ): void => {
    if (!child?.pid || childClosed || foregroundTermination) return;
    foregroundTermination = terminateForegroundProcessGroup({
      dependencies,
      processGroupId: child.pid,
      requestedSignal: signal,
    }).catch((error: unknown) => {
      foregroundTerminationError =
        error instanceof Error ? error : new Error(String(error));
    });
  };

  const handleSignal = (signal: SupervisorSignal): void => {
    signalCount += 1;
    if (signalCount > 1) {
      if (child?.pid && (!childClosed || foregroundTermination)) {
        dependencies.signalProcessGroup(child.pid, "SIGKILL");
      }
      console.error(
        "Cleanup abandoned after a second signal; the isolated run lease was preserved.",
      );
      dependencies.forceExit(signalExitCode(signal));
      return;
    }
    requestedSignal = signal;
    beginForegroundTermination(signal);
  };
  const handleSigint = () => handleSignal("SIGINT");
  const handleSigterm = () => handleSignal("SIGTERM");

  dependencies.signalSource.on("SIGINT", handleSigint);
  dependencies.signalSource.on("SIGTERM", handleSigterm);
  let outcome: ChildOutcome;
  try {
    child = dependencies.spawnChild(
      "pnpm",
      ["--silent", "run", input.runScript],
      {
        cwd: repositoryRoot,
        detached: true,
        env: environment,
        shell: false,
        stdio: "inherit",
      },
    );
    if (requestedSignal) beginForegroundTermination(requestedSignal);
    outcome = await waitForChild(child);
    if (
      !foregroundTermination &&
      child.pid &&
      dependencies.isProcessGroupAlive(child.pid)
    ) {
      beginForegroundTermination(requestedSignal ?? "SIGTERM");
    }
    childClosed = true;
    if (foregroundTermination) {
      await foregroundTermination;
      foregroundTermination = null;
    }
  } catch (error) {
    outcome = {
      code: 1,
      error: error instanceof Error ? error : new Error(String(error)),
      signal: null,
    };
  }

  try {
    const cleanup = await cleanupIsolatedCore({
      lease,
      nodexHome,
      releaseLeaseOnSuccess: false,
      runId,
      dependencies: dependencies.cleanupDependencies,
    });
    const observedChildExitCode = childExitCode(outcome, requestedSignal);
    const safeToDeleteRunRoot =
      cleanup.safeToDeleteRunRoot && !foregroundTerminationError;
    if (safeToDeleteRunRoot) lease.release();
    if (outcome.error) {
      console.error(`Isolated run child failed: ${boundedReason(outcome.error)}`);
    }
    if (foregroundTerminationError) {
      console.error(
        `Isolated foreground shutdown failed: ${boundedReason(
          foregroundTerminationError,
        )}`,
      );
    }
    if (cleanup.status === "stopped") {
      console.log("Stopped isolated Nodex Core.");
    }
    if (!cleanup.safeToDeleteRunRoot) {
      console.error(
        `Warning: isolated Core shutdown could not be confirmed: ${
          cleanup.reason ?? cleanup.status
        }`,
      );
    }
    return {
      childExitCode:
        observedChildExitCode === 0 && !safeToDeleteRunRoot
          ? 1
          : observedChildExitCode,
      cleanupStatus: cleanup.status,
      safeToDeleteRunRoot,
    };
  } finally {
    dependencies.signalSource.off("SIGINT", handleSigint);
    dependencies.signalSource.off("SIGTERM", handleSigterm);
  }
}

const scriptPath = fileURLToPath(import.meta.url);

async function main(): Promise<void> {
  const runScript = parseIsolatedRunSupervisorArguments(process.argv.slice(2));
  const nodexHome = process.env.NODEX_HOME;
  if (!nodexHome) {
    throw new Error("Isolated run supervisor requires NODEX_HOME");
  }
  const result = await superviseIsolatedRun({
    environment: process.env,
    nodexHome,
    repositoryRoot: path.resolve(path.dirname(scriptPath), ".."),
    runScript,
  });
  process.exitCode = result.childExitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  void main().catch((error: unknown) => {
    console.error(`Error: ${boundedReason(error)}`);
    process.exitCode = 1;
  });
}
