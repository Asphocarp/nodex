import type { CodexPermissionMode } from "../../shared/types";
import { getDb } from "./database";

interface PermissionModeSelectionRow {
  readonly mode: CodexPermissionMode;
}

export const getCodexProjectPermissionModeSelection = (
  projectId: string,
): CodexPermissionMode | null => {
  const row = getDb().prepare(`
    SELECT mode FROM codex_project_permission_mode_selections
    WHERE project_id = ?
  `).get(projectId) as PermissionModeSelectionRow | undefined;
  return row?.mode ?? null;
};

export const putCodexProjectPermissionModeSelection = (
  projectId: string,
  mode: CodexPermissionMode,
  updatedAt = new Date().toISOString(),
): void => {
  getDb().prepare(`
    INSERT INTO codex_project_permission_mode_selections (
      project_id, mode, updated_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      mode = excluded.mode,
      updated_at = excluded.updated_at
  `).run(projectId, mode, updatedAt);
};
