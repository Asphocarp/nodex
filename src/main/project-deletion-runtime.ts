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
 * Keep Project archival in the same FIFO as content mutations. Project-list
 * fanout occurs only after the archived lifecycle and binding revision commit;
 * Library Documents remain mounted/readable according to current grants.
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
