import type { PanelId, ProjectSessionTab, WorkspaceFileDirectoryEntry, WorkspaceFileMetadata } from "@/lib/types";

export type WorkspaceFilesTab = Omit<ProjectSessionTab, "projectId" | "config"> & {
  projectId: string | null;
  panelId: PanelId;
  preview?: true;
  config: {
    projectId: string | null;
    hostId?: "local";
    workspaceRoot?: string | null;
    cwd?: string | null;
    path?: string;
  };
};

export interface WorkspaceFileTreeNode {
  entry: WorkspaceFileDirectoryEntry;
  level: number;
}

export interface WorkspaceFilePreviewState {
  status: "idle" | "loading" | "loaded" | "unsupported" | "error";
  path: string | null;
  metadata: WorkspaceFileMetadata | null;
  content: string;
  binaryUrl: string | null;
  message: string | null;
}
