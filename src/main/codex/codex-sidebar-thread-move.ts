import path from "node:path";
import type { Project } from "../../shared/types";
import type { CodexProjectlessWorkspace } from "./codex-projectless-workspace";

export interface CodexSidebarThreadWorkspaceState {
  cwd: string | null;
  managedWorktreePath: string | null;
  projectlessOutputDirectory: string | null;
  projectlessWorkspaceBrowserRoot: string | null;
}

export interface CodexSidebarThreadWorkspaceMove {
  next: CodexSidebarThreadWorkspaceState;
  runtimeWorkspaceRoots: string[];
}

function normalizeRoot(root: string): string {
  const resolved = path.resolve(root.trim());
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function listProjectRoots(project: Project | null): string[] {
  return project?.sources
    .map((source) => source.root.trim())
    .filter(Boolean) ?? [];
}

/** Exact KUe: every source root must also be present in the destination project. */
export function listMissingCodexProjectMoveSources(
  sourceProject: Project | null,
  targetProject: Project | null,
): string[] {
  if (!sourceProject) return [];
  if (sourceProject.id === targetProject?.id) return [];

  const targetRoots = new Set(listProjectRoots(targetProject).map(normalizeRoot));
  return listProjectRoots(sourceProject).filter((root) => !targetRoots.has(normalizeRoot(root)));
}

export async function resolveCodexProjectThreadWorkspaceMove(input: {
  current: CodexSidebarThreadWorkspaceState;
  targetProject: Project;
  threadTitle: string;
  createProjectlessWorkspace: (input: {
    createSplitDirectories: true;
    prompt: string;
  }) => Promise<CodexProjectlessWorkspace>;
}): Promise<CodexSidebarThreadWorkspaceMove> {
  const projectRoots = listProjectRoots(input.targetProject);
  const singleProjectRoot = projectRoots.length === 1 ? projectRoots[0] ?? null : null;
  const generatedWorkspace = singleProjectRoot
    ? null
    : await input.createProjectlessWorkspace({
        createSplitDirectories: true,
        prompt: input.threadTitle,
      });
  const projectCwd = singleProjectRoot ?? generatedWorkspace?.cwd ?? null;
  const worktreeCwd = input.current.managedWorktreePath && input.current.cwd
    ? input.current.cwd
    : null;
  const cwd = worktreeCwd ?? projectCwd;
  const runtimeWorkspaceRoots = worktreeCwd
    ? [worktreeCwd]
    : generatedWorkspace
      ? [generatedWorkspace.workspaceRoot, ...projectRoots]
      : projectRoots;

  return {
    next: {
      cwd,
      managedWorktreePath: input.current.managedWorktreePath,
      projectlessOutputDirectory: generatedWorkspace?.outputDirectory ?? null,
      projectlessWorkspaceBrowserRoot: generatedWorkspace?.workspaceRoot ?? null,
    },
    runtimeWorkspaceRoots,
  };
}

export function resolveCodexProjectlessThreadWorkspaceMove(input: {
  current: CodexSidebarThreadWorkspaceState;
  persistedRuntimeWorkspaceRoots: readonly string[];
}): CodexSidebarThreadWorkspaceMove {
  return {
    next: { ...input.current },
    runtimeWorkspaceRoots: [...input.persistedRuntimeWorkspaceRoots],
  };
}

