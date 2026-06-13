import { randomUUID } from "node:crypto";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  type Project,
  type ProjectCreateInput,
  type ProjectSource,
  type ProjectUpdateInput,
} from "../../shared/types";
import {
  normalizeProjectIcon,
  normalizeProjectIconUpdate,
} from "../../shared/project-icon";
import { getDb } from "./database";
import { dbNotifier } from "./db-notifier";

interface DbProjectRow {
  id: string;
  name: string;
  description: string;
  icon: string;
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
    name: row.name,
    description: row.description,
    icon: normalizeProjectIcon(row.icon),
    sources,
    primaryWorkspaceRoot: sources[0]?.root ?? null,
    created: new Date(row.created),
    updated: new Date(row.updated),
  };
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

export function listProjects(): Project[] {
  const database = getDb();
  const rows = database.prepare(`
    SELECT p.*
    FROM projects p
    LEFT JOIN project_order po ON po.project_id = p.id
    ORDER BY COALESCE(po."order", 999999), p.created ASC
  `).all() as DbProjectRow[];
  return rows.map((row) => rowToProject(database, row));
}

export function getProject(projectId: string): Project | null {
  const canonicalProjectId = resolveProjectId(projectId);
  if (!canonicalProjectId) return null;

  const database = getDb();
  const row = database
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(canonicalProjectId) as DbProjectRow | undefined;
  return row ? rowToProject(database, row) : null;
}

export function createProject(input: ProjectCreateInput): Project {
  const database = getDb();
  const now = new Date().toISOString();
  const projectId = randomUUID();
  const sources = normalizeProjectSources(input.sources);
  const name = resolveProjectName(input, sources);
  const description = input.description ?? "";
  const icon = normalizeProjectIcon(input.icon);

  const txn = database.transaction(() => {
    database.prepare('UPDATE project_order SET "order" = "order" + 1').run();
    database.prepare(`
      INSERT INTO projects (id, name, description, icon, created, updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(projectId, name, description, icon, now, now);
    database.prepare(`
      INSERT INTO project_order (project_id, "order", updated)
      VALUES (?, 0, ?)
    `).run(projectId, now);
    insertProjectSources(database, projectId, sources, now);
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

export function deleteProject(projectId: string): boolean {
  const canonicalProjectId = resolveProjectId(projectId);
  if (!canonicalProjectId) return false;

  const result = getDb().prepare("DELETE FROM projects WHERE id = ?").run(canonicalProjectId);
  if (result.changes > 0) {
    dbNotifier.notifyProjectsChanged("delete", canonicalProjectId);
  }
  return result.changes > 0;
}

export function resolveProjectRunContext(projectId: string): ProjectRunContext {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const workspaceRoots = project.sources.map((source) => source.root);
  return {
    canonicalProjectId: project.id,
    cwd: workspaceRoots[0] ?? null,
    workspaceRoots,
    projectlessOutputDirectory: null,
  };
}
