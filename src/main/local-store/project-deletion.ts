import type Database from "better-sqlite3";

import { requireBlockStoreEpoch } from "./block-store-metadata";
import { deleteBlockFoundationForProject } from "./schema";

export interface ProjectDeletionResult {
  readonly deleted: boolean;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly deletedDocumentIds: readonly string[];
  readonly retiredBlockCount: number;
}

const normalizeProjectId = (projectId: string): string => {
  const normalized = projectId.trim();
  if (normalized) return normalized;
  throw new TypeError("projectId must be non-empty");
};

/**
 * Delete one Project and its entire Block foundation in one writer-owned
 * transaction. `deleteBlockFoundationForProject` permanently retires every
 * application identity before physical deletion; the returned Document IDs
 * let the main-process Hub revoke mounted surfaces only after commit.
 */
export const deleteProjectBlockFirst = (
  database: Database.Database,
  requestedProjectId: string,
): ProjectDeletionResult => {
  const projectId = normalizeProjectId(requestedProjectId);
  const storeEpoch = requireBlockStoreEpoch(database);
  const project = database
    .prepare("SELECT id FROM projects WHERE id = ?")
    .get(projectId) as { readonly id: string } | undefined;
  if (!project) {
    return {
      deleted: false,
      projectId,
      storeEpoch,
      deletedDocumentIds: [],
      retiredBlockCount: 0,
    };
  }

  const deletedDocumentIds = (
    database
      .prepare("SELECT id FROM documents WHERE project_id = ? ORDER BY id")
      .all(project.id) as readonly { readonly id: string }[]
  ).map((row) => row.id);
  const retiredBlockCount = (
    database
      .prepare("SELECT COUNT(*) AS count FROM blocks WHERE project_id = ?")
      .get(project.id) as { readonly count: number }
  ).count;
  const retiredAt = new Date().toISOString();

  const deleteTransaction = database.transaction(() => {
    deleteBlockFoundationForProject(database, project.id, retiredAt);
    const result = database
      .prepare("DELETE FROM projects WHERE id = ?")
      .run(project.id);
    if (result.changes !== 1) {
      throw new Error(`Project ${project.id} disappeared during deletion`);
    }
  });
  deleteTransaction.immediate();

  return {
    deleted: true,
    projectId: project.id,
    storeEpoch,
    deletedDocumentIds,
    retiredBlockCount,
  };
};
