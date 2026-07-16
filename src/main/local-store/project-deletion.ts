import type Database from "better-sqlite3";

import { requireBlockStoreEpoch } from "./block-store-metadata";

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
 * Remove one execution Project from active product surfaces without touching
 * Library content. The persisted Project and its Database binding become
 * archived so historical Sessions remain addressable and reactivation can
 * recompute current access.
 */
export const deleteProjectBlockFirst = (
  database: Database.Database,
  requestedProjectId: string,
): ProjectDeletionResult => {
  const projectId = normalizeProjectId(requestedProjectId);
  const storeEpoch = requireBlockStoreEpoch(database);
  const project = database
    .prepare("SELECT id, lifecycle FROM projects WHERE id = ?")
    .get(projectId) as
      | { readonly id: string; readonly lifecycle: string }
      | undefined;
  if (!project || project.lifecycle === "archived") {
    return {
      deleted: false,
      projectId,
      storeEpoch,
      deletedDocumentIds: [],
      retiredBlockCount: 0,
    };
  }

  const archivedAt = new Date().toISOString();

  const deleteTransaction = database.transaction(() => {
    database.prepare("DELETE FROM pinned_project_order WHERE project_id = ?")
      .run(project.id);
    database.prepare("DELETE FROM project_order WHERE project_id = ?")
      .run(project.id);
    const result = database.prepare(`
      UPDATE projects
      SET lifecycle = 'archived',
          binding_revision = binding_revision + 1,
          updated = ?
      WHERE id = ? AND lifecycle <> 'archived'
    `).run(archivedAt, project.id);
    if (result.changes !== 1) {
      throw new Error(`Project ${project.id} changed during archival`);
    }
  });
  deleteTransaction.immediate();

  return {
    deleted: true,
    projectId: project.id,
    storeEpoch,
    deletedDocumentIds: [],
    retiredBlockCount: 0,
  };
};
