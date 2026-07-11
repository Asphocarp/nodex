import { blockMutationWriter, type BlockMutationEnvelope } from "./block-mutation-writer";
import { documentSyncHub } from "./document-sync-runtime";
import { dbNotifier } from "./local-store/notifier";
import type { ProjectDeletionResult } from "./local-store/project-deletion";
import { getLogger } from "./logging/logger";

interface ProjectDeletionWriter {
  readonly deleteProject: (
    projectId: string,
  ) => Promise<BlockMutationEnvelope<ProjectDeletionResult>>;
}

export interface ProjectDeletionRuntimeDependencies {
  readonly writer: ProjectDeletionWriter;
  readonly resetDeletedDocuments: (
    documentIds: readonly string[],
    storeEpoch: string,
  ) => void;
  readonly notifyProjectDeleted: (projectId: string) => void;
  readonly onPostCommitError?: (error: unknown) => void;
}

export interface ProjectDeletionRuntime {
  readonly deleteProject: (projectId: string) => Promise<boolean>;
}

/**
 * Keep Project deletion in the same FIFO as every Document mutation. Hub
 * authorization and project-list fanout are revoked only after SQLite has
 * atomically retired every Block identity and committed the deletion.
 */
export const createProjectDeletionRuntime = (
  dependencies: ProjectDeletionRuntimeDependencies,
): ProjectDeletionRuntime => ({
  deleteProject: async (projectId) => {
    const { result } = await dependencies.writer.deleteProject(projectId);
    if (!result.deleted) return false;

    const postCommitOperations = [
      () =>
        dependencies.resetDeletedDocuments(
          result.deletedDocumentIds,
          result.storeEpoch,
        ),
      () => dependencies.notifyProjectDeleted(result.projectId),
    ];
    for (const operation of postCommitOperations) {
      try {
        operation();
      } catch (error) {
        dependencies.onPostCommitError?.(error);
      }
    }
    return true;
  },
});

const logger = getLogger({
  subsystem: "ipc",
  component: "project-deletion-runtime",
});

export const projectDeletionRuntime = createProjectDeletionRuntime({
  writer: blockMutationWriter,
  resetDeletedDocuments: (documentIds, storeEpoch) =>
    documentSyncHub.resetForDeletedDocuments(documentIds, storeEpoch),
  notifyProjectDeleted: (projectId) =>
    dbNotifier.notifyProjectsChanged("delete", projectId),
  onPostCommitError: (error) => {
    logger.warn("Project deletion committed but realtime fanout failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  },
});
