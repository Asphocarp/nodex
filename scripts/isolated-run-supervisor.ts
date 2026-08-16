import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  ISOLATED_RUN_ID_ENV,
  acquireIsolatedRunLease,
} from "../src/main/core-client/isolated-run-ownership";
import {
  cleanupIsolatedCore,
  type IsolatedCoreCleanupDependencies,
  type IsolatedCoreCleanupStatus,
} from "./isolated-core-cleanup";
export {
  cleanupIsolatedCore,
  type IsolatedCoreCleanupDependencies,
  type IsolatedCoreCleanupResult,
  type IsolatedCoreCleanupStatus,
} from "./isolated-core-cleanup";

const DEFAULT_CORE_IDLE_TIMEOUT_MS = "30000";
const FOREGROUND_INTERRUPT_GRACE_MS = 1_500;
const FOREGROUND_TERMINATE_GRACE_MS = 1_500;
const FOREGROUND_KILL_GRACE_MS = 1_000;
const FOREGROUND_POLL_INTERVAL_MS = 25;
const DUPLICATE_SIGNAL_WINDOW_MS = 250;
const MAX_DIAGNOSTIC_CHARS = 512;

export interface SupervisedCommandPlan {
  readonly command: string;
  readonly args: readonly string[];
}

export interface SupervisedRunPreparationContext {
  readonly environment: NodeJS.ProcessEnv;
  readonly runId: string;
}

export interface SupervisedRunResult {
  readonly childExitCode: number;
  readonly cleanupStatus: IsolatedCoreCleanupStatus;
  readonly safeToDeleteRunRoot: boolean;
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
  readonly command: SupervisedCommandPlan;
  readonly environment: NodeJS.ProcessEnv;
  readonly nodexHome: string;
  readonly repositoryRoot: string;
  readonly prepare?: (
    context: SupervisedRunPreparationContext,
  ) => Promise<void>;
  readonly dependencies?: Partial<IsolatedRunSupervisorDependencies>;
}

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
  let lastSignalAt: number | null = null;
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
    const observedAt = dependencies.now();
    if (
      lastSignalAt !== null
      && observedAt - lastSignalAt <= DUPLICATE_SIGNAL_WINDOW_MS
    ) {
      return;
    }
    lastSignalAt = observedAt;
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
    await input.prepare?.({ environment, runId });
    child = dependencies.spawnChild(
      input.command.command,
      input.command.args,
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
