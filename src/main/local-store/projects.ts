import { randomUUID } from "node:crypto";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  type Project,
  type ProjectCreateInput,
  type ProjectLifecycleInput,
  type ProjectOrderInput,
  type ProjectPinnedInput,
  type ProjectPinnedOrderInput,
  type ProjectSource,
  type ProjectUpdateInput,
} from "../../shared/types";
import {
  ProjectLifecycleInputSchema,
  ProjectOrderInputSchema,
  ProjectPinnedInputSchema,
  ProjectPinnedOrderInputSchema,
} from "../../shared/schemas/projects";
import {
  normalizeProjectIcon,
  normalizeProjectIconUpdate,
} from "../../shared/project-icon";
import { getDb } from "./database";
import { dbNotifier } from "./notifier";
import { insertInitialDatabaseViewSession } from "./project-session-defaults";
import {
  ensureBlockFoundationForProject,
  ensureLocalProfileLibrary,
  primaryDatabaseBlockId,
} from "./schema";
import { ensurePrimaryCanvasDocument } from "./primary-canvas-document";

interface DbProjectRow {
  id: string;
  library_id: string;
  database_block_id: string;
  lifecycle: "active" | "inactive" | "archived";
  binding_revision: number;
  name: string;
  description: string;
  icon: string;
  pinned_order: number | null;
  created: string;
  updated: string;
}

interface DbProjectSourceRow {
  root: string;
  order: number;
}

interface ProjectRunContext {
  canonicalProjectId: string;
  cwd: string | null;
  workspaceRoots: string[];
  projectlessOutputDirectory: string | null;
}

function normalizeProjectSourceRoot(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return path.resolve(trimmed);
}

export function getProjectSourceKey(root: string): string {
  const resolved = path.resolve(root.trim());
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function normalizeProjectSources(values: readonly string[] | undefined): ProjectSource[] {
  const roots = values ?? [];
  const seen = new Set<string>();
  const sources: ProjectSource[] = [];

  for (const value of roots) {
    const root = normalizeProjectSourceRoot(value);
    if (!root) continue;
    const rootKey = getProjectSourceKey(root);
    if (seen.has(rootKey)) continue;
    seen.add(rootKey);
    sources.push({
      root,
      order: sources.length,
    });
  }

  return sources;
}

function resolveProjectName(input: ProjectCreateInput, sources: readonly ProjectSource[]): string {
  const explicitName = input.name?.trim();
  if (explicitName) return explicitName;
  const firstSource = sources[0]?.root;
  if (firstSource) return path.basename(firstSource) || "New project";
  return "New project";
}

function readProjectSources(database: Database.Database, projectId: string): ProjectSource[] {
  const rows = database
    .prepare('SELECT root, "order" FROM project_sources WHERE project_id = ? ORDER BY "order" ASC, created ASC')
    .all(projectId) as DbProjectSourceRow[];
  return rows.map((row, index) => ({
    root: row.root,
    order: Number.isFinite(row.order) ? row.order : index,
  }));
}

function rowToProject(database: Database.Database, row: DbProjectRow): Project {
  const sources = readProjectSources(database, row.id);
  return {
    id: row.id,
    libraryId: row.library_id,
    databaseId: row.database_block_id,
    lifecycle: row.lifecycle,
    bindingRevision: row.binding_revision,
    name: row.name,
    description: row.description,
    icon: normalizeProjectIcon(row.icon),
    sources,
    primaryWorkspaceRoot: sources[0]?.root ?? null,
    pinned: row.pinned_order !== null,
    pinnedOrder: row.pinned_order,
    created: new Date(row.created),
    updated: new Date(row.updated),
  };
}

function readProjectRow(database: Database.Database, projectId: string): DbProjectRow | undefined {
  return database.prepare(`
    SELECT p.*, ppo."order" AS pinned_order
    FROM projects p
    LEFT JOIN pinned_project_order ppo ON ppo.project_id = p.id
    WHERE p.id = ?
  `).get(projectId) as DbProjectRow | undefined;
}

function sameProjectIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  if (leftSet.size !== left.length) return false;
  const rightSet = new Set(right);
  if (rightSet.size !== right.length) return false;
  for (const id of leftSet) {
    if (!rightSet.has(id)) return false;
  }
  return true;
}

function orderedProjectIds(database: Database.Database): string[] {
  const rows = database.prepare(`
    SELECT p.id
    FROM projects p
    LEFT JOIN project_order po ON po.project_id = p.id
    WHERE p.lifecycle <> 'archived'
    ORDER BY COALESCE(po."order", 999999), p.created ASC
  `).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function orderedPinnedProjectIds(database: Database.Database): string[] {
  const rows = database.prepare(`
    SELECT p.id
    FROM pinned_project_order ppo
    INNER JOIN projects p ON p.id = ppo.project_id
    ORDER BY ppo."order" ASC, p.created ASC
  `).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function insertProjectSources(
  database: Database.Database,
  projectId: string,
  sources: readonly ProjectSource[],
  now: string,
): void {
  const insert = database.prepare(`
    INSERT INTO project_sources (project_id, root, root_key, "order", created, updated)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const source of sources) {
    insert.run(projectId, source.root, getProjectSourceKey(source.root), source.order, now, now);
  }
}

function replaceProjectSources(
  database: Database.Database,
  projectId: string,
  sources: readonly ProjectSource[],
  now: string,
): void {
  database.prepare("DELETE FROM project_sources WHERE project_id = ?").run(projectId);
  insertProjectSources(database, projectId, sources, now);
}

export function resolveProjectId(projectId: string): string | null {
  const normalized = projectId.trim();
  if (!normalized) return null;

  const database = getDb();
  const row = database.prepare("SELECT id FROM projects WHERE id = ?").get(normalized) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

export function requireProjectId(projectId: string): string {
  const canonicalProjectId = resolveProjectId(projectId);
  if (!canonicalProjectId) throw new Error(`Project not found: ${projectId}`);
  return canonicalProjectId;
}

export function requireActiveProjectId(projectId: string): string {
  const canonicalProjectId = requireProjectId(projectId);
  const project = getProject(canonicalProjectId);
  if (!project || project.lifecycle !== "active") {
    throw new Error(
      `Project ${canonicalProjectId} is ${project?.lifecycle ?? "missing"} and cannot start work`,
    );
  }
  return canonicalProjectId;
}

export function listProjects(): Project[] {
  const database = getDb();
  const rows = database.prepare(`
    SELECT p.*, ppo."order" AS pinned_order
    FROM projects p
    LEFT JOIN project_order po ON po.project_id = p.id
    LEFT JOIN pinned_project_order ppo ON ppo.project_id = p.id
    WHERE p.lifecycle <> 'archived'
    ORDER BY COALESCE(po."order", 999999), p.created ASC
  `).all() as DbProjectRow[];
  return rows.map((row) => rowToProject(database, row));
}

export function getProject(projectId: string): Project | null {
  const canonicalProjectId = resolveProjectId(projectId);
  if (!canonicalProjectId) return null;

  const database = getDb();
  const row = readProjectRow(database, canonicalProjectId);
  return row ? rowToProject(database, row) : null;
}

export function createProject(input: ProjectCreateInput): Project {
  const database = getDb();
  const now = new Date().toISOString();
  const projectId = randomUUID();
  const { libraryId } = ensureLocalProfileLibrary(database, now);
  const databaseBlockId = primaryDatabaseBlockId(projectId);
  const sources = normalizeProjectSources(input.sources);
  const name = resolveProjectName(input, sources);
  const description = input.description ?? "";
  const icon = normalizeProjectIcon(input.icon);

  const txn = database.transaction(() => {
    database.prepare('UPDATE project_order SET "order" = "order" + 1').run();
    database.prepare(`
      INSERT INTO projects (
        id, library_id, database_block_id, lifecycle, binding_revision,
        name, description, icon, created, updated
      ) VALUES (?, ?, ?, 'active', 1, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      libraryId,
      databaseBlockId,
      name,
      description,
      icon,
      now,
      now,
    );
    database.prepare(`
      INSERT INTO project_order (project_id, "order", updated)
      VALUES (?, 0, ?)
    `).run(projectId, now);
    insertProjectSources(database, projectId, sources, now);
    insertInitialDatabaseViewSession(database, projectId, now, { shiftExisting: false });
    ensureBlockFoundationForProject(database, projectId, now);
    ensurePrimaryCanvasDocument(database, projectId);
  });
  txn();

  dbNotifier.notifyProjectsChanged("create", projectId);
  const project = getProject(projectId);
  if (!project) throw new Error(`Created project not found: ${projectId}`);
  return project;
}

export function updateProject(projectId: string, updates: ProjectUpdateInput): Project | null {
  const canonicalProjectId = resolveProjectId(projectId);
  if (!canonicalProjectId) return null;

  const database = getDb();
  const now = new Date().toISOString();
  const normalizedIcon = normalizeProjectIconUpdate(updates.icon);
  const shouldReplaceSources = updates.sources !== undefined;
  const nextSources = shouldReplaceSources
    ? normalizeProjectSources(updates.sources)
    : null;

  const txn = database.transaction(() => {
    if (updates.name !== undefined) {
      database.prepare("UPDATE projects SET name = ?, updated = ? WHERE id = ?")
        .run(updates.name.trim() || "New project", now, canonicalProjectId);
    }
    if (updates.description !== undefined) {
      database.prepare("UPDATE projects SET description = ?, updated = ? WHERE id = ?")
        .run(updates.description, now, canonicalProjectId);
    }
    if (normalizedIcon !== undefined) {
      database.prepare("UPDATE projects SET icon = ?, updated = ? WHERE id = ?")
        .run(normalizedIcon, now, canonicalProjectId);
    }
    if (nextSources) {
      replaceProjectSources(database, canonicalProjectId, nextSources, now);
      database.prepare("UPDATE projects SET updated = ? WHERE id = ?").run(now, canonicalProjectId);
    }
  });
  txn();

  dbNotifier.notifyProjectsChanged("update", canonicalProjectId);
  return getProject(canonicalProjectId);
}

export function setProjectLifecycle(
  projectId: string,
  input: ProjectLifecycleInput,
): Project | null {
  const parsed = ProjectLifecycleInputSchema.parse(input);
  const canonicalProjectId = resolveProjectId(projectId);
  if (!canonicalProjectId) return null;

  const database = getDb();
  const current = readProjectRow(database, canonicalProjectId);
  if (!current) return null;
  if (current.lifecycle === parsed.lifecycle) return rowToProject(database, current);

  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare(`
      UPDATE projects
      SET lifecycle = ?, binding_revision = binding_revision + 1, updated = ?
      WHERE id = ?
    `).run(parsed.lifecycle, now, canonicalProjectId);

    if (parsed.lifecycle === "archived") {
      database.prepare("DELETE FROM pinned_project_order WHERE project_id = ?")
        .run(canonicalProjectId);
      database.prepare("DELETE FROM project_order WHERE project_id = ?")
        .run(canonicalProjectId);
      return;
    }
    if (current.lifecycle !== "archived") return;
    database.prepare(`
      INSERT INTO project_order (project_id, "order", updated)
      SELECT ?, COALESCE(MAX("order"), -1) + 1, ? FROM project_order
    `).run(canonicalProjectId, now);
  })();

  dbNotifier.notifyProjectsChanged("update", canonicalProjectId);
  return getProject(canonicalProjectId);
}

export function reorderProjects(input: ProjectOrderInput): Project[] {
  const parsed = ProjectOrderInputSchema.parse(input);
  const database = getDb();
  const currentIds = orderedProjectIds(database);
  if (!sameProjectIdSet(currentIds, parsed.orderedProjectIds)) {
    throw new Error("Project reorder input must contain the same project ids as the current sidebar order");
  }

  const now = new Date().toISOString();
  const updateOrder = database.prepare(`
    INSERT INTO project_order (project_id, "order", updated)
    VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      "order" = excluded."order",
      updated = excluded.updated
  `);
  database.transaction(() => {
    parsed.orderedProjectIds.forEach((projectId, index) => updateOrder.run(projectId, index, now));
  })();

  dbNotifier.notifyProjectsChanged("reorder");
  return listProjects();
}

export function setProjectPinned(projectId: string, input: ProjectPinnedInput): Project | null {
  const parsed = ProjectPinnedInputSchema.parse(input);
  const canonicalProjectId = resolveProjectId(projectId);
  if (!canonicalProjectId) return null;

  const database = getDb();
  const now = new Date().toISOString();
  if (parsed.pinned) {
    const maxPinnedOrder = database.prepare(`
      SELECT MAX("order") AS maxPinnedOrder
      FROM pinned_project_order
    `).get() as { maxPinnedOrder: number | null } | undefined;
    const nextPinnedOrder = (maxPinnedOrder?.maxPinnedOrder ?? -1) + 1;

    database.prepare(`
      INSERT INTO pinned_project_order (project_id, "order", updated)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO NOTHING
    `).run(canonicalProjectId, nextPinnedOrder, now);
  } else {
    database.prepare("DELETE FROM pinned_project_order WHERE project_id = ?").run(canonicalProjectId);
  }

  dbNotifier.notifyProjectsChanged("pin", canonicalProjectId);
  return getProject(canonicalProjectId);
}

export function setPinnedProjectOrder(input: ProjectPinnedOrderInput): Project[] {
  const parsed = ProjectPinnedOrderInputSchema.parse(input);
  const database = getDb();
  const currentPinnedIds = orderedPinnedProjectIds(database);
  if (!sameProjectIdSet(currentPinnedIds, parsed.orderedProjectIds)) {
    throw new Error("Pinned project reorder input must contain the same pinned project ids as the current sidebar order");
  }

  const now = new Date().toISOString();
  const updateOrder = database.prepare(`
    UPDATE pinned_project_order
    SET "order" = ?, updated = ?
    WHERE project_id = ?
  `);
  database.transaction(() => {
    parsed.orderedProjectIds.forEach((projectId, index) => updateOrder.run(index, now, projectId));
  })();

  dbNotifier.notifyProjectsChanged("pin");
  return listProjects();
}

export function resolveProjectRunContext(projectId: string): ProjectRunContext {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (project.lifecycle !== "active") {
    throw new Error(
      `Project ${projectId} is ${project.lifecycle} and cannot start work`,
    );
  }
  const workspaceRoots = project.sources.map((source) => source.root);
  return {
    canonicalProjectId: project.id,
    cwd: workspaceRoots[0] ?? null,
    workspaceRoots,
    projectlessOutputDirectory: null,
  };
}
