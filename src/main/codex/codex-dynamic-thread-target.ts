import type {
  CodexDynamicCreateStartingState,
  CodexDynamicCreateTarget,
} from "./codex-dynamic-thread-create";
import type { CodexProjectlessWorkspace } from "./codex-projectless-workspace";

export interface CodexDynamicCreateProjectTarget {
  readonly id: string;
  readonly sources: readonly { readonly root: string }[];
}

export interface CodexDynamicThreadTargetDependencies {
  readonly getProject: (
    projectId: string,
  ) => CodexDynamicCreateProjectTarget | null | Promise<CodexDynamicCreateProjectTarget | null>;
  readonly createProjectlessWorkspace: (input: {
    readonly createSplitDirectories: true;
    readonly directoryName?: string;
    readonly prompt: string;
  }) => Promise<CodexProjectlessWorkspace>;
}

interface CodexResolvedDynamicThreadTargetBase {
  readonly projectId: string | null;
  readonly cwd: string;
  readonly workspaceRoots: readonly string[];
  readonly workspaceKind: "project" | "projectless";
  readonly projectlessOutputDirectory: string | null;
  readonly projectlessWorkspaceBrowserRoot: string | null;
}

export interface CodexResolvedDynamicDirectThreadTarget
  extends CodexResolvedDynamicThreadTargetBase {
  readonly launchMode: "direct";
}

export interface CodexResolvedDynamicWorktreeThreadTarget
  extends CodexResolvedDynamicThreadTargetBase {
  readonly launchMode: "worktree";
  readonly projectId: string;
  readonly workspaceKind: "project";
  readonly startingState?: CodexDynamicCreateStartingState;
}

export type CodexResolvedDynamicThreadTarget =
  | CodexResolvedDynamicDirectThreadTarget
  | CodexResolvedDynamicWorktreeThreadTarget;

async function createGeneratedWorkspace(
  dependencies: CodexDynamicThreadTargetDependencies,
  input: {
    readonly directoryName?: string;
    readonly prompt: string;
  },
): Promise<CodexProjectlessWorkspace> {
  return await dependencies.createProjectlessWorkspace({
    createSplitDirectories: true,
    prompt: input.prompt,
    ...(input.directoryName === undefined ? {} : { directoryName: input.directoryName }),
  });
}

export async function resolveCodexDynamicCreateTarget(
  input: {
    readonly prompt: string;
    readonly target: CodexDynamicCreateTarget;
  },
  dependencies: CodexDynamicThreadTargetDependencies,
): Promise<CodexResolvedDynamicThreadTarget> {
  if (input.target.type === "projectless") {
    const workspace = await createGeneratedWorkspace(dependencies, {
      prompt: input.prompt,
      directoryName: input.target.directoryName,
    });
    return {
      launchMode: "direct",
      projectId: null,
      cwd: workspace.cwd,
      workspaceRoots: [workspace.workspaceRoot],
      workspaceKind: "projectless",
      projectlessOutputDirectory: workspace.outputDirectory,
      projectlessWorkspaceBrowserRoot: workspace.workspaceRoot,
    };
  }

  const project = await dependencies.getProject(input.target.projectId);
  if (!project) {
    throw new Error(
      `Unknown projectId: ${input.target.projectId}. Call list_projects to find available projects.`,
    );
  }

  const projectRoots = project.sources.map((source) => source.root);
  if (input.target.environment.type === "worktree") {
    if (projectRoots.length !== 1) {
      throw new Error("Worktree threads require a project with exactly one directory");
    }
    return {
      launchMode: "worktree",
      projectId: input.target.projectId,
      cwd: projectRoots[0],
      workspaceRoots: [projectRoots[0]],
      workspaceKind: "project",
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
      ...(input.target.environment.startingState === undefined
        ? {}
        : { startingState: input.target.environment.startingState }),
    };
  }

  if (projectRoots.length === 1) {
    return {
      launchMode: "direct",
      projectId: input.target.projectId,
      cwd: projectRoots[0],
      workspaceRoots: projectRoots,
      workspaceKind: "project",
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
    };
  }

  const workspace = await createGeneratedWorkspace(dependencies, {
    prompt: input.prompt,
  });
  return {
    launchMode: "direct",
    projectId: input.target.projectId,
    cwd: workspace.cwd,
    workspaceRoots: [workspace.workspaceRoot, ...projectRoots],
    workspaceKind: "project",
    projectlessOutputDirectory: workspace.outputDirectory,
    projectlessWorkspaceBrowserRoot: workspace.workspaceRoot,
  };
}
