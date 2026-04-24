import { invoke } from "./api";
import type {
  WorkbenchLayoutSnapshot,
  WorkspaceBootstrap,
} from "./types";

export async function bootstrapWorkspaces(): Promise<WorkspaceBootstrap> {
  return (await invoke("workspaces:bootstrap")) as WorkspaceBootstrap;
}

export async function createWorkspace(
  name: string,
  layout: WorkbenchLayoutSnapshot,
  icon?: string | null,
): Promise<WorkspaceBootstrap> {
  return (await invoke("workspaces:create", name, layout, icon)) as WorkspaceBootstrap;
}

export async function renameWorkspace(
  workspaceId: string,
  name: string,
  icon?: string | null,
): Promise<WorkspaceBootstrap> {
  return (await invoke("workspaces:rename", workspaceId, name, icon)) as WorkspaceBootstrap;
}

export async function deleteWorkspace(workspaceId: string): Promise<WorkspaceBootstrap> {
  return (await invoke("workspaces:delete", workspaceId)) as WorkspaceBootstrap;
}

export async function saveWorkspaceLayout(
  workspaceId: string,
  layout: WorkbenchLayoutSnapshot,
): Promise<WorkspaceBootstrap> {
  return (await invoke("workspaces:save-layout", workspaceId, layout)) as WorkspaceBootstrap;
}

export async function setActiveWorkspace(workspaceId: string): Promise<WorkspaceBootstrap> {
  return (await invoke("workspaces:set-active", workspaceId)) as WorkspaceBootstrap;
}
