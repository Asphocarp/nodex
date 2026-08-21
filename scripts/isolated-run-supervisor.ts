import path from "node:path";

import { resolveIsolatedRunSupervisorDependencies } from "./effect-adapters/isolated-run-live";
import {
  IsolatedRunFailure,
  superviseIsolatedRunEffect,
} from "./effect-control-plane/isolated-run";
import { runScriptControlPlanePromise } from "./effect-control-plane/runtime";
import type { SuperviseIsolatedRunInput, SupervisedRunResult } from "./isolated-run-contract";

export type {
  IsolatedRunSupervisorDependencies,
  SupervisedCommandPlan,
  SupervisedRunPreparationContext,
  SupervisedRunResult,
  SupervisorSignalSource,
} from "./isolated-run-contract";
export {
  cleanupIsolatedCore,
  type IsolatedCoreCleanupDependencies,
  type IsolatedCoreCleanupResult,
  type IsolatedCoreCleanupStatus,
} from "./isolated-core-cleanup";

const MAX_DIAGNOSTIC_CHARS = 512;

const requireAbsolutePath = (candidate: string, label: string): string => {
  if (path.isAbsolute(candidate)) return path.normalize(candidate);
  throw new Error(`${label} must be absolute`);
};

const boundedReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/gu, " ").slice(0, MAX_DIAGNOSTIC_CHARS);
};

export function superviseIsolatedRun(
  input: SuperviseIsolatedRunInput,
): Promise<SupervisedRunResult> {
  const nodexHome = requireAbsolutePath(input.nodexHome, "Nodex home");
  const repositoryRoot = requireAbsolutePath(input.repositoryRoot, "Repository root");
  const dependencies = resolveIsolatedRunSupervisorDependencies(input.dependencies);
  const runId = dependencies.generateRunId();
  return runScriptControlPlanePromise(
    superviseIsolatedRunEffect({
      dependencies,
      nodexHome,
      repositoryRoot,
      runId,
      runInput: input,
      onCleanupAbandoned: (exitCode) => {
        console.error(
          "Cleanup abandoned after a second signal; the isolated run lease was preserved.",
        );
        dependencies.forceExit(exitCode);
      },
    }),
  )
    .catch((error: unknown) => {
      throw error instanceof IsolatedRunFailure ? error.cause : error;
    })
    .then((execution) => {
      if (execution.childError) {
        console.error(`Isolated run child failed: ${boundedReason(execution.childError)}`);
      }
      if (execution.foregroundTerminationError) {
        console.error(
          `Isolated foreground shutdown failed: ${boundedReason(
            execution.foregroundTerminationError,
          )}`,
        );
      }
      if (execution.result.cleanupStatus === "stopped") {
        console.log("Stopped isolated Nodex Core.");
      }
      if (execution.cleanupReason !== null) {
        console.error(
          `Warning: isolated Core shutdown could not be confirmed: ${execution.cleanupReason}`,
        );
      }
      return execution.result;
    });
}
