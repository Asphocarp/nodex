import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import {
  createCoreProjectWorkspaceAdapter,
  type DesktopProjectWorkspacePort,
} from "./project-workspace-adapter";

export interface DesktopProjectWorkspaceBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly typescript: DesktopProjectWorkspacePort;
}

export function createDesktopProjectWorkspaceBridge(
  input: DesktopProjectWorkspaceBridgeInput,
): DesktopProjectWorkspacePort {
  let coreAdapter: DesktopProjectWorkspacePort | null = null;

  const resolve = async (): Promise<DesktopProjectWorkspacePort> => {
    const runtime = await input.authority;
    if (runtime.backend === "typescript") return input.typescript;
    coreAdapter ??= createCoreProjectWorkspaceAdapter(runtime.rootClient);
    return coreAdapter;
  };

  return {
    listProjects: async () => await (await resolve()).listProjects(),
    getProject: async (projectId) =>
      await (await resolve()).getProject(projectId),
    createProject: async (projectInput) =>
      await (await resolve()).createProject(projectInput),
    updateProject: async (projectId, projectInput) =>
      await (await resolve()).updateProject(projectId, projectInput),
    reorderProjects: async (projectInput) =>
      await (await resolve()).reorderProjects(projectInput),
    setProjectPinned: async (projectId, projectInput) =>
      await (await resolve()).setProjectPinned(projectId, projectInput),
    setPinnedProjectOrder: async (projectInput) =>
      await (await resolve()).setPinnedProjectOrder(projectInput),
    deleteProject: async (projectId) =>
      await (await resolve()).deleteProject(projectId),
    listProjectSessions: async (projectId, options) =>
      await (await resolve()).listProjectSessions(projectId, options),
    listProjectSessionSummaries: async (projectId, options) =>
      await (await resolve()).listProjectSessionSummaries(projectId, options),
    getProjectSession: async (sessionId) =>
      await (await resolve()).getProjectSession(sessionId),
  };
}
