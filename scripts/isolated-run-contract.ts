import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { IsolatedCoreCleanupDependencies } from "./isolated-core-cleanup";

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
  readonly cleanupStatus: import("./isolated-core-cleanup").IsolatedCoreCleanupStatus;
  readonly safeToDeleteRunRoot: boolean;
}

export interface SupervisorSignalSource {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface IsolatedRunSupervisorDependencies {
  readonly cleanupDependencies?: Partial<IsolatedCoreCleanupDependencies>;
  readonly delay: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  readonly forceExit: (exitCode: number) => void;
  readonly generateRunId: () => string;
  readonly isProcessGroupAlive: (processGroupId: number) => boolean;
  readonly now: () => number;
  readonly signalSource: SupervisorSignalSource;
  readonly signalProcessGroup: (processGroupId: number, signal: NodeJS.Signals) => void;
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
  readonly prepare?: (context: SupervisedRunPreparationContext) => Promise<void>;
  readonly dependencies?: Partial<IsolatedRunSupervisorDependencies>;
}
