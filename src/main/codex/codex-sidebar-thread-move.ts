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
  return project?.sources.map((source) => source.root.trim()).filter(Boolean) ?? [];
}

function isProjectRootCovered(sourceRoot: string, targetRoot: string): boolean {
  const source = normalizeRoot(sourceRoot);
  const target = normalizeRoot(targetRoot);
  const relative = path.relative(target, source);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** A destination root grants access to itself and every nested source root. */
export function listMissingCodexProjectMoveSources(
  sourceProject: Project | null,
  targetProject: Project | null,
): string[] {
  if (!sourceProject) return [];
  if (sourceProject.id === targetProject?.id) return [];

  const targetRoots = listProjectRoots(targetProject);
  return listProjectRoots(sourceProject).filter(
    (sourceRoot) => !targetRoots.some((targetRoot) => isProjectRootCovered(sourceRoot, targetRoot)),
  );
}

export function appendMissingCodexProjectMoveSources(
  targetProject: Project,
  missingProjectSources: readonly string[],
): Project {
  const roots = [...listProjectRoots(targetProject), ...missingProjectSources];
  const seen = new Set<string>();
  const sources = roots.flatMap((root) => {
    const key = normalizeRoot(root);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ root, order: seen.size - 1 }];
  });
  return {
    ...targetProject,
    sources,
    primaryWorkspaceRoot: sources[0]?.root ?? null,
  };
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
  const singleProjectRoot = projectRoots.length === 1 ? (projectRoots[0] ?? null) : null;
  const generatedWorkspace = singleProjectRoot
    ? null
    : await input.createProjectlessWorkspace({
        createSplitDirectories: true,
        prompt: input.threadTitle,
      });
  const projectCwd = singleProjectRoot ?? generatedWorkspace?.cwd ?? null;
  const worktreeCwd =
    input.current.managedWorktreePath && input.current.cwd ? input.current.cwd : null;
  const cwd = worktreeCwd ?? projectCwd;
  const runtimeWorkspaceRoots = worktreeCwd
    ? [...new Set([worktreeCwd, ...projectRoots])]
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
