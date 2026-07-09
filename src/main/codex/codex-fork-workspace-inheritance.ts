export interface CodexForkWorkspaceInheritance {
  readonly projectId: string | null;
  readonly projectlessOutputDirectory: string | null;
  readonly projectlessWorkspaceBrowserRoot: string | null;
}

export function resolveCodexForkWorkspaceInheritance(source: {
  readonly projectId?: string | null;
  readonly projectlessOutputDirectory?: string | null;
  readonly projectlessWorkspaceBrowserRoot?: string | null;
}): CodexForkWorkspaceInheritance {
  return {
    projectId: source.projectId ?? null,
    projectlessOutputDirectory: source.projectlessOutputDirectory ?? null,
    projectlessWorkspaceBrowserRoot: source.projectlessWorkspaceBrowserRoot ?? null,
  };
}
