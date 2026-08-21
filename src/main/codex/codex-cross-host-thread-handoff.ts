import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { CodexCrossHostPreparedHandoff } from "./codex-thread-handoff-journal";
import type { CodexExecutionHostRegistry } from "./codex-execution-host-registry";
import type {
  CodexWorktreeWorkerExportHandoffResult,
  CodexWorktreeWorkerImportHandoffResult,
} from "./codex-worktree-worker-port";

export interface PrepareCodexCrossHostThreadHandoffInput {
  readonly operationId: string;
  readonly threadId: string;
  readonly threadTitle: string;
  readonly projectId: string;
  readonly sourceHostId: string;
  readonly destinationHostId: string;
  readonly sourceCwd: string;
  readonly sourceWorkspaceRoot: string;
  readonly sourceManagedWorktreePath: string | null;
  readonly sourceRolloutPath: string;
  readonly destinationRepositoryPaths: readonly string[];
  readonly onPathAllocated: (input: {
    readonly hostId: string;
    readonly worktreeGitRoot: string;
  }) => void;
  readonly onPhase: (phase: string, status: "running" | "success" | "error") => void;
  readonly signal?: AbortSignal;
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function rolloutRelativePath(codexHome: string, rolloutPath: string): string {
  const relative = path.relative(path.resolve(codexHome), path.resolve(rolloutPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Task rollout is outside its execution host Codex home");
  }
  return relative;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function transferIdForOperation(operationId: string): string {
  return createHash("sha256").update(operationId, "utf8").digest("hex").slice(0, 32);
}

/**
 * Main-owned relay for cross-host state. Workers own Git and rollout placement;
 * Main only handles integrity-checked opaque files in its private handoff root.
 */
export class CodexCrossHostThreadHandoffService {
  constructor(
    private readonly options: {
      readonly executionHosts: CodexExecutionHostRegistry;
      readonly relayBaseRoot: string;
    },
  ) {}

  async prepare(
    input: PrepareCodexCrossHostThreadHandoffInput,
  ): Promise<CodexCrossHostPreparedHandoff> {
    if (input.sourceHostId === input.destinationHostId) {
      throw new Error("Cross-host handoff requires two different execution hosts");
    }
    if (input.destinationRepositoryPaths.length === 0) {
      throw new Error("Destination host has no authorized repository candidates");
    }

    const sourceWorker = this.options.executionHosts.requireWorktreeWorker(
      input.sourceHostId,
      "export-handoff",
    );
    const destinationWorker = this.options.executionHosts.requireWorktreeWorker(
      input.destinationHostId,
      "import-handoff",
    );
    const sourceTransfer = this.options.executionHosts.requireFileTransfer(input.sourceHostId);
    const destinationTransfer = this.options.executionHosts.requireFileTransfer(
      input.destinationHostId,
    );
    const sourceStagingRoot = this.options.executionHosts.requireHandoffStagingRoot(
      input.sourceHostId,
    );
    const destinationStagingRoot = this.options.executionHosts.requireHandoffStagingRoot(
      input.destinationHostId,
    );
    const sourceCodexHome = this.options.executionHosts.requireCodexHome(input.sourceHostId);
    const destinationCodexHome = this.options.executionHosts.requireCodexHome(
      input.destinationHostId,
    );
    const relativeRolloutPath = rolloutRelativePath(sourceCodexHome, input.sourceRolloutPath);
    const transferId = transferIdForOperation(input.operationId);
    const relayRoot = path.join(path.resolve(this.options.relayBaseRoot), transferId, "relay");
    if (!isWithin(this.options.relayBaseRoot, relayRoot)) {
      throw new Error("Cross-host relay path escapes the private handoff root");
    }
    await mkdir(relayRoot, { recursive: true, mode: 0o700 });

    let exported: CodexWorktreeWorkerExportHandoffResult | null = null;
    let imported: CodexWorktreeWorkerImportHandoffResult | null = null;
    try {
      exported = await sourceWorker.exportHandoff(
        {
          requestId: `${input.operationId}:export`,
          hostId: input.sourceHostId,
          transferId,
          sourceCwd: input.sourceCwd,
          sourceWorkspaceRoot: input.sourceWorkspaceRoot,
          stagingRoot: sourceStagingRoot,
        },
        {
          signal: input.signal ?? new AbortController().signal,
          onEvent: (event) => {
            if (event.type !== "handoff-progress") return;
            input.onPhase(
              event.step,
              event.status === "failed"
                ? "error"
                : event.status === "completed" || event.status === "skipped"
                  ? "success"
                  : "running",
            );
          },
        },
      );
      const sourceRollout = await sourceTransfer.describe(input.sourceRolloutPath, input.signal);
      input.onPhase("transfer-state", "running");
      const [relayBundle, relayRollout] = await Promise.all([
        sourceTransfer.download({
          source: exported.bundle,
          destinationPath: path.join(relayRoot, "source.bundle"),
          signal: input.signal,
        }),
        sourceTransfer.download({
          source: sourceRollout,
          destinationPath: path.join(relayRoot, "rollout.jsonl"),
          signal: input.signal,
        }),
      ]);
      const [destinationBundle, stagedDestinationRollout] = await Promise.all([
        destinationTransfer.upload({
          localPath: relayBundle.path,
          operationId: transferId,
          fileName: "source.bundle",
          sha256: relayBundle.sha256,
          size: relayBundle.size,
          signal: input.signal,
        }),
        destinationTransfer.upload({
          localPath: relayRollout.path,
          operationId: transferId,
          fileName: "rollout.jsonl",
          sha256: relayRollout.sha256,
          size: relayRollout.size,
          signal: input.signal,
        }),
      ]);
      input.onPhase("transfer-state", "success");

      imported = await destinationWorker.importHandoff(
        {
          requestId: `${input.operationId}:import`,
          hostId: input.destinationHostId,
          transferId,
          bundlePath: destinationBundle.path,
          rolloutPath: stagedDestinationRollout.path,
          rolloutRelativePath: relativeRolloutPath,
          destinationCodexHome,
          sourceCommit: exported.sourceCommit,
          repositoryIdentity: exported.repositoryIdentity,
          candidateRepositoryPaths: input.destinationRepositoryPaths,
          managedRoot: this.options.executionHosts.requireManagedRoot(input.destinationHostId),
          nodexHome: this.options.executionHosts.requireNodexHome(input.destinationHostId),
          projectId: input.projectId,
          threadId: input.threadId,
          threadTitle: input.threadTitle,
        },
        {
          signal: input.signal ?? new AbortController().signal,
          onEvent: (event) => {
            if (event.type === "path-allocated") {
              input.onPathAllocated({
                hostId: input.destinationHostId,
                worktreeGitRoot: event.worktreeGitRoot,
              });
              return;
            }
            if (event.type !== "handoff-progress") return;
            input.onPhase(
              event.step,
              event.status === "failed"
                ? "error"
                : event.status === "completed" || event.status === "skipped"
                  ? "success"
                  : "running",
            );
          },
        },
      );

      return {
        direction: "cross-host",
        sourceHostId: input.sourceHostId,
        destinationHostId: input.destinationHostId,
        transferId,
        sourceBranch: exported.sourceBranch,
        sourceWorkspaceRoot: input.sourceWorkspaceRoot,
        sourceManagedWorktreePath: input.sourceManagedWorktreePath,
        destinationWorkspaceRoot: imported.destinationWorkspaceRoot,
        destinationGitRoot: imported.destinationGitRoot,
        managedWorktreePath: imported.managedWorktreePath,
        createdWorktree: true,
        sourceRepositoryPath: exported.sourceRepositoryPath,
        destinationRepositoryPath: imported.destinationRepositoryPath,
        sourceTemporaryRef: exported.temporaryRef,
        destinationTemporaryRef: imported.temporaryRef,
        sourceStagingRoot,
        destinationStagingRoot,
        relayRoot,
        sourceBundle: exported.bundle,
        destinationBundle,
        sourceRollout,
        destinationRollout: {
          path: imported.destinationRolloutPath,
          sha256: sourceRollout.sha256,
          size: sourceRollout.size,
        },
        destinationRolloutCreated: imported.destinationRolloutCreated,
        warnings: [],
      };
    } catch (error) {
      const cleanupWarnings = await this.#cleanupPartial({
        input,
        exported,
        imported,
        relayRoot,
        sourceStagingRoot,
        destinationStagingRoot,
        destinationCodexHome,
      });
      if (cleanupWarnings.length === 0) throw error;
      throw new AggregateError(
        [error, ...cleanupWarnings.map((warning) => new Error(warning))],
        `Cross-host handoff failed: ${errorMessage(error)}; cleanup requires attention`,
      );
    }
  }

  async cleanup(
    prepared: CodexCrossHostPreparedHandoff,
    outcome: "committed" | "rolled-back",
  ): Promise<readonly string[]> {
    const warnings: string[] = [];
    const sourceWorker = this.options.executionHosts.requireWorktreeWorker(
      prepared.sourceHostId,
      "cleanup-transfer-handoff",
    );
    const destinationWorker = this.options.executionHosts.requireWorktreeWorker(
      prepared.destinationHostId,
      "cleanup-transfer-handoff",
    );
    const requestSignal = new AbortController().signal;
    const collect = async (
      label: string,
      operation: () => Promise<readonly string[]>,
    ): Promise<void> => {
      try {
        warnings.push(...(await operation()));
      } catch (error) {
        warnings.push(`${label}: ${errorMessage(error)}`);
      }
    };
    await collect("destination cleanup", async () => {
      const result = await destinationWorker.cleanupTransferHandoff(
        {
          requestId: `handoff:cleanup:destination:${prepared.destinationHostId}:${prepared.sourceTemporaryRef}`,
          hostId: prepared.destinationHostId,
          transferId: prepared.transferId,
          stagingRoot: prepared.destinationStagingRoot,
          repositoryPath: prepared.destinationRepositoryPath,
          temporaryRef: prepared.destinationTemporaryRef,
          managedRoot: this.options.executionHosts.requireManagedRoot(prepared.destinationHostId),
          createdWorktreePath: prepared.managedWorktreePath,
          createdRolloutPath: prepared.destinationRolloutCreated
            ? prepared.destinationRollout.path
            : null,
          destinationCodexHome: this.options.executionHosts.requireCodexHome(
            prepared.destinationHostId,
          ),
          outcome,
        },
        { signal: requestSignal },
      );
      return result.warnings;
    });
    await collect("source cleanup", async () => {
      const result = await sourceWorker.cleanupTransferHandoff(
        {
          requestId: `handoff:cleanup:source:${prepared.sourceHostId}:${prepared.sourceTemporaryRef}`,
          hostId: prepared.sourceHostId,
          transferId: prepared.transferId,
          stagingRoot: prepared.sourceStagingRoot,
          repositoryPath: prepared.sourceRepositoryPath,
          temporaryRef: prepared.sourceTemporaryRef,
          managedRoot: null,
          createdWorktreePath: null,
          createdRolloutPath: null,
          destinationCodexHome: null,
          outcome,
        },
        { signal: requestSignal },
      );
      return result.warnings;
    });
    await collect("destination transfer cleanup", async () => {
      await this.options.executionHosts
        .requireFileTransfer(prepared.destinationHostId)
        .cleanup(prepared.transferId);
      return [];
    });
    await collect("source transfer cleanup", async () => {
      await this.options.executionHosts
        .requireFileTransfer(prepared.sourceHostId)
        .cleanup(prepared.transferId);
      return [];
    });
    await collect("relay cleanup", async () => {
      if (!isWithin(this.options.relayBaseRoot, prepared.relayRoot)) {
        throw new Error("refused to clean relay outside private handoff root");
      }
      await rm(prepared.relayRoot, { recursive: true, force: true });
      return [];
    });
    return warnings;
  }

  async #cleanupPartial(input: {
    readonly input: PrepareCodexCrossHostThreadHandoffInput;
    readonly exported: CodexWorktreeWorkerExportHandoffResult | null;
    readonly imported: CodexWorktreeWorkerImportHandoffResult | null;
    readonly relayRoot: string;
    readonly sourceStagingRoot: string;
    readonly destinationStagingRoot: string;
    readonly destinationCodexHome: string;
  }): Promise<string[]> {
    const warnings: string[] = [];
    if (input.imported) {
      try {
        const result = await this.options.executionHosts
          .requireWorktreeWorker(input.input.destinationHostId, "cleanup-transfer-handoff")
          .cleanupTransferHandoff(
            {
              requestId: `${input.input.operationId}:prepare-failure:destination`,
              hostId: input.input.destinationHostId,
              transferId: transferIdForOperation(input.input.operationId),
              stagingRoot: input.destinationStagingRoot,
              repositoryPath: input.imported.destinationRepositoryPath,
              temporaryRef: input.imported.temporaryRef,
              managedRoot: this.options.executionHosts.requireManagedRoot(
                input.input.destinationHostId,
              ),
              createdWorktreePath: input.imported.managedWorktreePath,
              createdRolloutPath: input.imported.destinationRolloutCreated
                ? input.imported.destinationRolloutPath
                : null,
              destinationCodexHome: input.destinationCodexHome,
              outcome: "rolled-back",
            },
            { signal: new AbortController().signal },
          );
        warnings.push(...result.warnings);
      } catch (error) {
        warnings.push(`destination prepare cleanup: ${errorMessage(error)}`);
      }
    } else {
      const transferId = transferIdForOperation(input.input.operationId);
      const destinationRef = `refs/codex/handoff/destination/${transferId}`;
      const destinationRolloutPath = path.resolve(
        input.destinationCodexHome,
        rolloutRelativePath(
          this.options.executionHosts.requireCodexHome(input.input.sourceHostId),
          input.input.sourceRolloutPath,
        ),
      );
      for (const [index, repositoryPath] of input.input.destinationRepositoryPaths.entries()) {
        try {
          const result = await this.options.executionHosts
            .requireWorktreeWorker(input.input.destinationHostId, "cleanup-transfer-handoff")
            .cleanupTransferHandoff(
              {
                requestId: `${input.input.operationId}:prepare-failure:destination:${String(index)}`,
                hostId: input.input.destinationHostId,
                transferId,
                stagingRoot: input.destinationStagingRoot,
                repositoryPath,
                temporaryRef: destinationRef,
                managedRoot: this.options.executionHosts.requireManagedRoot(
                  input.input.destinationHostId,
                ),
                createdWorktreePath: null,
                createdRolloutPath: index === 0 ? destinationRolloutPath : null,
                destinationCodexHome: input.destinationCodexHome,
                outcome: "rolled-back",
              },
              { signal: new AbortController().signal },
            );
          warnings.push(...result.warnings);
        } catch (error) {
          warnings.push(`destination reconciliation ${repositoryPath}: ${errorMessage(error)}`);
        }
      }
    }
    if (input.exported) {
      try {
        const result = await this.options.executionHosts
          .requireWorktreeWorker(input.input.sourceHostId, "cleanup-transfer-handoff")
          .cleanupTransferHandoff(
            {
              requestId: `${input.input.operationId}:prepare-failure:source`,
              hostId: input.input.sourceHostId,
              transferId: transferIdForOperation(input.input.operationId),
              stagingRoot: input.sourceStagingRoot,
              repositoryPath: input.exported.sourceRepositoryPath,
              temporaryRef: input.exported.temporaryRef,
              managedRoot: null,
              createdWorktreePath: null,
              createdRolloutPath: null,
              destinationCodexHome: null,
              outcome: "rolled-back",
            },
            { signal: new AbortController().signal },
          );
        warnings.push(...result.warnings);
      } catch (error) {
        warnings.push(`source prepare cleanup: ${errorMessage(error)}`);
      }
    }
    for (const [label, hostId] of [
      ["destination transfer cleanup", input.input.destinationHostId],
      ["source transfer cleanup", input.input.sourceHostId],
    ] as const) {
      try {
        await this.options.executionHosts
          .requireFileTransfer(hostId)
          .cleanup(transferIdForOperation(input.input.operationId));
      } catch (error) {
        warnings.push(`${label}: ${errorMessage(error)}`);
      }
    }
    await rm(input.relayRoot, { recursive: true, force: true }).catch((error) =>
      warnings.push(`relay cleanup: ${errorMessage(error)}`),
    );
    return warnings;
  }
}
