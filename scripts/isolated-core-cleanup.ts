import { lstatSync } from "node:fs";
import path from "node:path";

import type { components } from "@nodex/core-protocol";
import { CoreClient } from "../src/main/core-client/core-client";
import {
  readIsolatedRunClaim,
  type IsolatedRunClaim,
  type IsolatedRunLease,
} from "../src/main/core-client/isolated-run-ownership";
import { readCoreRuntimeConnection } from "../src/main/core-client/runtime-descriptor";
import type { CoreRuntimeDescriptor } from "../src/main/core-client/types";

const CORE_BUILD_ID = "nodex-isolated-run-supervisor";
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const MAX_DIAGNOSTIC_CHARS = 512;

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

type RuntimeGeneration = components["schemas"]["RuntimeGenerationIdentity"];
type ShutdownResponse = components["schemas"]["ShutdownResponse"];
type CoreRuntimeEvidence = "none" | "partial" | "complete";

interface CoreShutdownClient {
  readonly handshake: { readonly generation: RuntimeGeneration };
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
  readonly inspectRuntimeEvidence: (nodexHome: string) => CoreRuntimeEvidence;
  readonly isPidAlive: (pid: number) => boolean;
  readonly now: () => number;
  readonly readClaim: (nodexHome: string) => IsolatedRunClaim | null;
  readonly readRuntimeGeneration: (nodexHome: string) => RuntimeGeneration;
}

const isFileSystemError = (error: unknown, code: string): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && error.code === code;

const runtimeEntryPaths = (nodexHome: string) => {
  const runtimeDirectory = path.join(nodexHome, "run/core");
  return {
    runtimeDirectory,
    descriptor: path.join(runtimeDirectory, "core.json"),
    auth: path.join(runtimeDirectory, "core.auth"),
    socket: path.join(runtimeDirectory, "core.sock"),
  };
};

const inspectRuntimeEvidence = (nodexHome: string): CoreRuntimeEvidence => {
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

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isFileSystemError(error, "ESRCH")) return false;
    if (isFileSystemError(error, "EPERM")) return true;
    throw error;
  }
};

const runtimeGenerationFromDescriptor = (descriptor: CoreRuntimeDescriptor): RuntimeGeneration => ({
  artifact_sha256: descriptor.artifact.sha256,
  manifest_digest: descriptor.manifest_digest,
  pid: descriptor.pid,
  profile_id: descriptor.profile_id,
  readiness_generation: descriptor.readiness_generation,
  start_nonce: descriptor.start_nonce,
  store_epoch: descriptor.store_epoch,
});

const sameGeneration = (left: RuntimeGeneration, right: RuntimeGeneration): boolean =>
  left.artifact_sha256 === right.artifact_sha256 &&
  left.manifest_digest === right.manifest_digest &&
  left.pid === right.pid &&
  left.profile_id === right.profile_id &&
  left.readiness_generation === right.readiness_generation &&
  left.start_nonce === right.start_nonce &&
  left.store_epoch === right.store_epoch;

const defaultDependencies: IsolatedCoreCleanupDependencies = {
  connectCore: (input) => CoreClient.connect(input),
  delay: (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
  inspectRuntimeEvidence,
  isPidAlive,
  now: Date.now,
  readClaim: readIsolatedRunClaim,
  readRuntimeGeneration: (nodexHome) =>
    runtimeGenerationFromDescriptor(readCoreRuntimeConnection(nodexHome).descriptor),
};

const cleanupFailure = (
  status: Exclude<IsolatedCoreCleanupStatus, "not_started" | "stopped">,
  reason: string,
): IsolatedCoreCleanupResult => ({ status, safeToDeleteRunRoot: false, reason });

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
  if (!path.isAbsolute(input.nodexHome)) {
    return cleanupFailure("failed", "Nodex home must be absolute");
  }
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  try {
    const evidence = dependencies.inspectRuntimeEvidence(input.nodexHome);
    const claim = dependencies.readClaim(input.nodexHome);
    if (evidence === "none") {
      if (claim && claim.runId !== input.runId) {
        return cleanupFailure("not_owner", "The isolated run claim belongs to another run");
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
      nodexHome: path.normalize(input.nodexHome),
      clientKind: "native_cli",
      buildId: CORE_BUILD_ID,
      requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    });
    const generation = client.handshake.generation;
    const shutdown = await client.shutdown();
    if (shutdown.status !== "draining") {
      return cleanupFailure(
        "failed",
        `Core rejected isolated shutdown with status ${shutdown.status}`,
      );
    }
    const deadline = dependencies.now() + (input.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
    while (true) {
      const currentEvidence = dependencies.inspectRuntimeEvidence(input.nodexHome);
      if (currentEvidence === "none" && !dependencies.isPidAlive(generation.pid)) {
        if (input.releaseLeaseOnSuccess !== false) input.lease.release();
        return { status: "stopped", safeToDeleteRunRoot: true };
      }
      if (currentEvidence === "complete") {
        try {
          if (!sameGeneration(dependencies.readRuntimeGeneration(input.nodexHome), generation)) {
            return cleanupFailure(
              "generation_changed",
              "Core runtime generation changed during isolated shutdown",
            );
          }
        } catch (error) {
          if (!isFileSystemError(error, "ENOENT")) throw error;
        }
      }
      if (dependencies.now() >= deadline) {
        return cleanupFailure("failed", "Timed out waiting for isolated Core to exit");
      }
      await dependencies.delay(input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return cleanupFailure(
      "failed",
      message.replaceAll(/\s+/gu, " ").slice(0, MAX_DIAGNOSTIC_CHARS),
    );
  }
}
